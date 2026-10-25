import { runBridge } from './stdio.ts';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help')
  process.stderr.write(
    'Teachshelf MCP stdio: node mcp-stdio.cjs --config /absolute/path/desktop-settings.json\n',
  );
else if (args.length !== 2 || args[0] !== '--config') {
  process.stderr.write('请提供 --config /absolute/path/desktop-settings.json\n');
  process.exitCode = 1;
} else
  runBridge(
    args[1],
    process.stdin,
    (line) => process.stdout.write(line),
    (line) => process.stderr.write(line),
  ).catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : 'MCP桥接失败') + '\n');
    process.exitCode = 1;
  });
