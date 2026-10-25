/* Read only the currently loaded Moodle course/resource/assignment DOM. No requests or login access. */
(doc, href) => {
    const url = new URL(href);
    const allowed = ['/course/view.php', '/mod/folder/view.php', '/mod/assign/view.php', '/mod/resource/view.php'];
    if (url.origin !== 'https://selearning.nju.edu.cn' || !allowed.includes(url.pathname)) throw new Error('请在教学网站课程页面读取。');
    const clean = el => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const main = doc.querySelector('#region-main');
    if (!main) throw new Error('页面结构无法识别，请等待加载完成后重试。');
    const profile = doc.querySelector('.usermenu a[href*="/user/profile.php"], #page-footer a[href*="/user/profile.php"], footer a[href*="/user/profile.php"]');
    const accountID = profile ? new URL(profile.href).searchParams.get('id') || '' : '';
    if (!/^\d+$/.test(accountID)) throw new Error('请先完成教学网站登录。');
    const kind = url.pathname === '/course/view.php' ? 'course' : url.pathname.split('/')[2];
    const courseAnchor = Array.from(doc.querySelectorAll('.breadcrumb a, nav[aria-label] a')).find(a => {
        try { const u = new URL(a.href); return u.origin === url.origin && u.pathname === '/course/view.php' && /^\d+$/.test(u.searchParams.get('id') || ''); } catch { return false; }
    });
    const courseID = kind === 'course' ? url.searchParams.get('id') : courseAnchor ? new URL(courseAnchor.href).searchParams.get('id') : '';
    if (!/^\d+$/.test(courseID || '')) throw new Error('无法确定该内容所属课程。');
    const page = {kind, accountID, courseID, title: kind === 'course' ? clean(doc.querySelector('h1')) : clean(main.querySelector('h2')) || clean(doc.querySelector('h1')), activities: [], files: [], intro: '', deadlineText: '', submitted: false};
    if (kind === 'course') {
        const content = main.querySelector('.course-content');
        if (!content) throw new Error('课程内容未加载，未进行更新。');
        const seen = new Set();
        for (const anchor of content.querySelectorAll('a[href]')) {
            let u; try { u = new URL(anchor.href); } catch { continue; }
            const activityKind = /^\/mod\/(folder|assign|resource)\/view.php$/.exec(u.pathname)?.[1];
            const id = u.searchParams.get('id');
            if (u.origin !== url.origin || !activityKind || !/^\d+$/.test(id || '') || seen.has(`${activityKind}:${id}`)) continue;
            seen.add(`${activityKind}:${id}`);
            const section = anchor.closest('li.section, [data-sectionid], section.section');
            const sectionName = clean(section?.querySelector('.sectionname, .section-title, h3')) || (activityKind === 'assign' ? '作业' : '课件');
            const label = anchor.querySelector('.instancename');
            let title = clean(label || anchor);
            const hiddenType = clean(label?.querySelector('.accesshide'));
            if (hiddenType && title.endsWith(hiddenType)) title = title.slice(0, -hiddenType.length).trim();
            if (!title) throw new Error('课程条目缺少名称。');
            page.activities.push({id, kind: activityKind, title: title.slice(0, 500), sectionID: section?.id || section?.getAttribute('data-sectionid') || sectionName, section: sectionName.slice(0, 100), url: `${url.origin}${u.pathname}?id=${id}`});
        }
        if (page.activities.length > 3000) throw new Error('课程条目过多，请分课程更新。');
    } else {
        const seen = new Set();
        for (const anchor of main.querySelectorAll('a[href]')) {
            let u; try { u = new URL(anchor.href); } catch { continue; }
            const marker = kind === 'assign' ? /\/mod_assign\/(?:introattachment|intro)\/\d+\/(.+)$/ : kind === 'folder' ? /\/mod_folder\/content\/\d+\/(.+)$/ : /\/mod_resource\/content\/\d+\/(.+)$/;
            const match = marker.exec(u.pathname);
            if (u.origin !== url.origin || !u.pathname.startsWith('/pluginfile.php/') || !match) continue;
            let path; try { path = decodeURIComponent(match[1]); } catch { throw new Error('文件名编码无法读取。'); }
            if (seen.has(path)) continue;
            const parts = path.split('/'); const name = parts.pop();
            if (!name || parts.some(p => !p || p === '.' || p === '..') || name === '.' || name === '..') continue;
            seen.add(path);
            page.files.push({key: path, name, subfolders: parts, url: `${u.origin}${u.pathname}?forcedownload=1`});
        }
        if (page.files.length > 3000) throw new Error('文件数量过多，未进行更新。');
        if (kind === 'assign') {
            page.intro = (main.querySelector('#intro')?.innerText || '').trim().slice(0, 80000);
            for (const row of main.querySelectorAll('table tr')) {
                const cells = row.querySelectorAll('th, td'); if (cells.length < 2) continue;
                const label = clean(cells[0]).toLowerCase(), value = clean(cells[1]);
                if (/^(到期日期|截止日期|截止时间|due date)$/.test(label)) {
                    if (!/^(?:-|无|未设置|no due date|none)$/i.test(value)) page.deadlineText = value;
                }
                if (/^(作业状态|提交状态|submission status)$/.test(label)) page.submitted = /已提交|submitted for grading/i.test(value);
            }
            if (!main.querySelector('.submissionstatustable, .submissionsummarytable, table.generaltable')) throw new Error('作业状态未加载，未更新该作业。');
        }
    }
    return JSON.stringify(page);
}
