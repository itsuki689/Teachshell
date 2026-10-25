/*
 * Undergraduate NJU timetable parser, adapted from Nan-Na timetable:
 * https://github.com/WheretoSleepinNJU/NJU-Class-Shedule-Flutter/blob/master/api/tools/njubksjw2.js
 * Licensed under Apache-2.0; see LICENSE-APACHE-2.0.txt and NOTICE.txt.
 * Modified for Teachshelf, 2026-10-14: scoped table discovery, single sections,
 * Chinese punctuation, odd/even weeks, diagnostics, and strict page checking.
 * Further modified 2026-10-14: exclude nested/frozen-column and CSS-hidden
 * tables, collapse exact duplicate course rows, and request explicit selection
 * when distinct visible timetable lists remain.
 * Reads timetable DOM only. No network requests, cookies, or credential access.
 */
(() => {
  "use strict";
  if (location.protocol !== "https:" || location.hostname !== "ehallapp.nju.edu.cn" ||
      !location.pathname.startsWith("/jwapp/sys/wdkb/")) {
    throw new Error("请在南京大学本科教务课表页面读取课表。");
  }
  const term = document.querySelector("#dqxnxqkclb");
  const name = term?.textContent.trim();
  if (!name) throw new Error("找不到当前学期，请先打开本科课表列表。");
  const warnings = [];
  const courses = [];
  // textContent on an outer cell includes nested tables. Read its own content
  // while preserving line breaks, so a layout table cannot impersonate a list.
  function ownText(node) {
    if (!node) return "";
    if (node.nodeType === 3) return node.nodeValue || "";
    if (["TABLE", "SCRIPT", "STYLE"].includes(node.tagName)) return "";
    if (node.tagName === "BR") return "\n";
    return Array.from(node.childNodes || []).map(ownText).join("");
  }
  const text = node => ownText(node).replace(/\u00a0/g, " ").trim();
  const rowsOf = table => Array.from(table.rows || table.querySelectorAll("tr"))
    .filter(row => row.closest("table") === table);
  const cellsOf = row => Array.from(row.cells || row.querySelectorAll("td,th"))
    .filter(cell => cell.closest("tr") === row);
  const isHeader = cells => /课程(?:号|代码|编号)/.test(text(cells[1])) || /课程名(?:称)?/.test(text(cells[2]));
  const hasPeriod = value => /自由时间/.test(value) || /[\d０-９]\s*(?:[-~至—–]\s*[\d０-９]+)?\s*节/.test(value);
  const isData = cells => cells.length >= 11 && !isHeader(cells) && text(cells[2]) && hasPeriod(text(cells[6]));
  function visible(element) {
    for (let node = element; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility) ||
          style.contentVisibility === "hidden" || Number(style.opacity) === 0) return false;
    }
    return Array.from(element.getClientRects()).some(rect => rect.width > 0 && rect.height > 0);
  }
  const visibleRowsOf = table => rowsOf(table).filter(visible);

  // Prefer the nearest term container that actually contains course rows; never
  // assume the page's first table is the timetable (menus also contain tables).
  let tables = [];
  for (let scope = term.parentElement; scope; scope = scope.parentElement) {
    const candidates = Array.from(scope.querySelectorAll("table")).filter(visible)
      .filter(table => visibleRowsOf(table).some(row => isData(cellsOf(row))));
    if (candidates.length) { tables = candidates; break; }
  }
  if (!tables.length) {
    tables = Array.from(document.querySelectorAll("table")).filter(visible)
      .filter(table => visibleRowsOf(table).some(row => isData(cellsOf(row))));
  }
  if (!tables.length) throw new Error("没有找到本科课表数据，请切换到课表列表并等待加载完成。");
  // Identity uses canonical row contents, not DOM positions. Trim/collapse
  // whitespace and sort rows, but retain repeated rows and every cell value:
  // distinct rooms/weeks/meetings are never merged by course name or row count.
  function canonicalRows(table) {
    return visibleRowsOf(table).map(cellsOf).filter(cells => cells.length && !isHeader(cells))
      .map(cells => JSON.stringify(cells.map(cell => text(cell).replace(/\s+/g, " ")))).sort();
  }
  function tableID(canonical) {
    let first = 0x811c9dc5, second = 0x9e3779b9;
    for (let index = 0; index < canonical.length; index++) {
      const code = canonical.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x85ebca6b);
      second ^= second >>> 13;
    }
    return `table-${canonical.length}-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
  }
  const unique = new Map();
  for (const table of tables) {
    const canonical = JSON.stringify(canonicalRows(table));
    if (!unique.has(canonical)) unique.set(canonical, { table, id: tableID(canonical) });
  }
  const candidates = [...unique.values()];
  const requestedID = typeof teachshelfSelectedTableID === "string" ? teachshelfSelectedTableID : null;
  let selected;
  if (requestedID !== null) {
    selected = candidates.find(candidate => candidate.id === requestedID);
    if (!selected) throw new Error("课表内容已变化，原选择已失效。请重新读取并选择课表。");
  } else if (candidates.length === 1) selected = candidates[0];
  else {
    return encodeURIComponent(JSON.stringify({ name, courses: [], warnings: [], tables: candidates.map(candidate => {
      const data = visibleRowsOf(candidate.table).map(cellsOf).filter(isData);
      return { id: candidate.id, rowCount: data.length, preview: [...new Set(data.map(cells => text(cells[2])))].slice(0, 3) };
    }) }));
  }

  const weekMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  function parseWeeks(source) {
    let rest = source.trimStart(), consumed = source.length - rest.length, hasWeekMark = false;
    const weeks = [];
    while (true) {
      const atom = rest.match(/^(?:第\s*)?(\d+)(?:\s*[-~至—–]\s*(\d+))?\s*(周)?\s*(?:\(\s*([单双])(?:周)?\s*\))?\s*(周)?/);
      if (!atom) break;
      const start = Number(atom[1]), end = Number(atom[2] || atom[1]);
      if (start < 1 || end < start || end > 60) throw new Error("周次应为 1–60 内的递增范围");
      hasWeekMark ||= Boolean(atom[3] || atom[5]);
      for (let week = start; week <= end; week++) {
        if (!atom[4] || (atom[4] === "单" ? week % 2 === 1 : week % 2 === 0)) weeks.push(week);
      }
      rest = rest.slice(atom[0].length); consumed += atom[0].length;
      const separator = rest.match(/^\s*[,、]\s*(?=\d)/);
      if (!separator) break;
      rest = rest.slice(separator[0].length); consumed += separator[0].length;
    }
    if (!hasWeekMark || !weeks.length) throw new Error("缺少有效周次");
    return { weeks: [...new Set(weeks)].sort((a, b) => a - b), remainder: source.slice(consumed).trim() };
  }

  visibleRowsOf(selected.table).forEach((row, rowIndex) => {
    const td = cellsOf(row);
    if (!td.length || isHeader(td)) return;
    if (td.length < 11) { warnings.push(`第 ${rowIndex + 1} 行列数不足，已跳过，请核对学校页面。`); return; }
    const courseName = text(td[2]);
    if (!courseName) { warnings.push(`第 ${rowIndex + 1} 行缺少课程名称，已跳过。`); return; }
    const base = {
      name: courseName, class_number: text(td[1]) || null, teacher: text(td[4]) || null,
      test_time: text(td[10]) || null, test_location: null, link: null,
      import_type: 1, info: text(td[8]) || null, data: null
    };
    const full = text(td[6]).replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
      .replace(/（/g, "(").replace(/）/g, ")").replace(/，/g, ",");
    if (!full) { warnings.push(`${courseName}：缺少时间地点，请在学校页面核对。`); return; }
    // Commas within "1–3周,10–13周" belong to one meeting. A new weekday
    // or free-time marker starts a new meeting; semicolons/newlines also split.
    const segments = full.split(/[;；]+|[,，\n]\s*(?=(?:周|星期|自由时间))/).map(s => s.trim()).filter(Boolean);
    segments.forEach(segment => {
      try {
        if (/自由时间/.test(segment)) {
          const rawWeeks = segment.replace(/自由时间/g, "").trim();
          let weeks = [];
          if (rawWeeks) {
            const firstWeek = rawWeeks.search(/\d/);
            if (firstWeek >= 0) weeks = parseWeeks(rawWeeks.slice(firstWeek)).weeks;
          }
          if (!weeks.length) warnings.push(`${courseName}：自由时间未注明周次，已保留为待安排课程。`);
          courses.push({ ...base, classroom: "自由地点", weeks, week_time: 0, start_time: 0, time_count: 0 });
          return;
        }
        const match = segment.match(/^(.*?)\s*(\d+)(?:\s*[-~至—–]\s*(\d+))?\s*节\s*(.+)$/);
        if (!match) throw new Error("无法识别上课节次");
        const start = Number(match[2]), end = Number(match[3] || match[2]);
        if (start < 1 || end < start || end > 30) throw new Error("节次应为 1–30 内的递增范围");
        const prefix = match[1].replace(/\s/g, "");
        const dayToken = prefix.match(/^(?:周|星期)([一二三四五六日天1-7])$/)?.[1];
        const weekday = dayToken ? (weekMap[dayToken] || Number(dayToken)) : null;
        const parsed = parseWeeks(match[4]);
        if (!weekday) throw new Error(`无法识别星期「${prefix || "未注明"}」`);
        courses.push({ ...base, classroom: parsed.remainder || null, weeks: parsed.weeks,
          week_time: weekday, start_time: start, time_count: end - start });
      } catch (error) {
        warnings.push(`${courseName}：${error.message}，已跳过「${segment}」。`);
      }
    });
  });
  if (!courses.length) throw new Error("未读到可导入课程。" + warnings.slice(0, 4).join(" "));
  return encodeURIComponent(JSON.stringify({ name, courses, warnings }));
})();
