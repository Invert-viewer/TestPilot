"""Build an offline Windows x64 frontend handoff from an explicit allowlist.

Run npm run build first. No backend files, reports, credentials or node_modules
are included. The runtime executable is copied from an existing Node install.
"""
from pathlib import Path
from datetime import datetime, timezone, timedelta
import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
import tempfile
import zipfile

FRONTEND = Path(__file__).resolve().parents[1]
PROJECT = FRONTEND.parent
PORTABLE = FRONTEND / 'portable'

def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def copy(file, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if file.suffix.lower() == '.bat':
        target.write_bytes(file.read_text(encoding='utf-8-sig').replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8'))
    else:
        shutil.copy2(file, target)

def render_markdown(markdown):
    # The input consists only of package-authored local documentation.
    out, code, table, listing, paragraph = [], False, False, None, []
    def inline(value):
        value = html.escape(value)
        value = re.sub(r'`([^`]+)`', r'<code>\1</code>', value)
        return re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', value)
    def flush():
        if paragraph:
            out.append('<p>' + inline(' '.join(paragraph)) + '</p>')
            paragraph.clear()
    def end_list():
        nonlocal listing
        if listing:
            out.append('</' + listing + '>')
            listing = None
    for line in markdown.splitlines():
        if line.startswith('```'):
            flush(); end_list()
            out.append('</code></pre>' if code else '<pre><code>')
            code = not code
            continue
        if code:
            out.append(html.escape(line) + '\n')
            continue
        if table and not line.startswith('|'):
            out.append('</tbody></table></div>'); table = False
        if line.startswith('|'):
            flush(); end_list()
            cells = line.strip('|').split('|')
            if all(re.fullmatch(r'\s*:?-+:?\s*', cell) for cell in cells):
                continue
            if not table:
                out.append('<div class="table-wrap"><table><tbody>'); table = True
            out.append('<tr>' + ''.join('<td>' + inline(cell.strip()) + '</td>' for cell in cells) + '</tr>')
            continue
        if not line.strip():
            flush(); end_list(); continue
        heading = re.match(r'^(#{1,6})\s+(.+)$', line)
        if heading:
            flush(); end_list(); level = min(len(heading[1]) + 1, 6)
            out.append(f'<h{level}>' + inline(heading[2]) + f'</h{level}>'); continue
        item = re.match(r'^(-|\d+\.)\s+(.+)$', line)
        if item:
            flush(); tag = 'ul' if item[1] == '-' else 'ol'
            if listing != tag:
                end_list(); out.append('<' + tag + '>'); listing = tag
            out.append('<li>' + inline(item[2]) + '</li>'); continue
        end_list(); paragraph.append(line)
    flush(); end_list()
    if table: out.append('</tbody></table></div>')
    return '\n'.join(out)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', default=shutil.which('node.exe') or shutil.which('node'))
    parser.add_argument('--output-dir', type=Path, default=PROJECT / '交付')
    parser.add_argument('--name')
    args = parser.parse_args()
    if not args.runtime:
        raise SystemExit('找不到 Node，请通过 --runtime 指定 Windows x64 node.exe。')
    runtime = Path(args.runtime).resolve()
    info = json.loads(subprocess.check_output([str(runtime), '-p', 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'], text=True))
    if info != {'version':'v26.12.1', 'platform':'win32', 'arch':'x64'}:
        raise SystemExit('本配套许可对应 Windows x64 Node v26.12.1；更换运行时前请先更新匹配许可和验证。')
    dist = FRONTEND / 'dist'
    if not (dist / 'index.html').is_file():
        raise SystemExit('缺少构建产物，请先 npm.cmd run build。')
    if max(p.stat().st_mtime for p in (FRONTEND / 'src').rglob('*') if p.is_file()) > (dist / 'index.html').stat().st_mtime:
        raise SystemExit('源码比 dist 更新，请先重新运行 npm.cmd run build。')
    now = datetime.now(timezone(timedelta(hours=8)))
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    name = args.name or 'TestPilot前端-即用版-' + now.strftime('%Y%m%d-%H%M%S')
    if Path(name).name != name or not name.strip():
        raise SystemExit('--name 只能是文件名，不含目录。')
    archive = output / (name + '.zip')
    if archive.exists():
        raise SystemExit('目标压缩包已存在，请更换 --name，避免覆盖。')
    staging_root = PROJECT / '.acceptance'
    staging_root.mkdir(exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='portable-stage-', dir=staging_root)) / 'TestPilot-Frontend'
    stage.mkdir()
    shutil.copytree(dist, stage / 'dist')
    for name in ['server.cjs','config.json','START.bat','启动前端.bat']:
        copy(PORTABLE / name, stage / name)
    copy(PORTABLE / 'docs/00-先读我.md', stage / '00-先读我.md')
    shutil.copytree(PORTABLE / 'docs', stage / 'docs')
    shutil.copytree(PORTABLE / 'examples', stage / 'examples')
    copy(runtime, stage / 'runtime/node.exe')
    copy(PORTABLE / 'licenses/Node-LICENSE.txt', stage / 'runtime/Node-LICENSE.txt')
    (stage / 'runtime/README.txt').write_text('Node.js v26.12.1 / Windows x64\n仅运行便携前端，不需要 npm。\n官方对应许可：https://raw.githubusercontent.com/nodejs/node/v26.12.1/LICENSE\n', encoding='utf-8')

    source = stage / 'source/frontend'
    source.mkdir(parents=True)
    for directory in ['src','tests','e2e','portable','scripts']:
        for file in (FRONTEND / directory).rglob('*'):
            if file.is_file() and '__pycache__' not in file.parts:
                copy(file, source / file.relative_to(FRONTEND))
    for name in ['package.json','package-lock.json','index.html','vite.config.js','vitest.config.ts','playwright.config.ts','tsconfig.json','README.md','.gitignore']:
        copy(FRONTEND / name, source / name)
    (stage / 'source/README.md').write_text('''# 前端源码与重新打包

这里只包含前端源码，Spring Boot 后端须使用原项目。

```powershell
cd frontend
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
python scripts/package_portable.py --runtime "..\\..\\runtime\\node.exe" --output-dir "..\\..\\重新交付"
```

源码开发另外需要 Node/npm 和 Python；普通使用不需要。测试/e2e 含真实任务用例，运行前阅读 2 号说明。重新打包脚本使用明确的文件清单，不复制 node_modules、数据库、令牌、本地后端配置或报告。若只运行源码开发服务，代理地址在 frontend/vite.config.js 中设置；便携成品读取根 config.json。
''', encoding='utf-8')
    for relative in ['前后端接口契约.md','分工和提交要求.md','parts/前端/design.md','验收/前端改造本地验收.md','验收/验收记录-第一条真实流程.md']:
        if (PROJECT / 'docs' / relative).is_file(): copy(PROJECT / 'docs' / relative, stage / 'source/docs' / relative)

    lock = json.loads((FRONTEND / 'package-lock.json').read_text(encoding='utf-8-sig'))
    licenses = []
    for relative, package in sorted(lock['packages'].items()):
        if not relative or package.get('dev'):
            continue
        folder = FRONTEND / relative
        if not folder.is_dir(): continue
        files = []
        for file in folder.iterdir():
            if file.is_file() and re.match(r'^(licen[sc]e|notice)(\b|[._-])', file.name, re.I):
                target = Path('THIRD_PARTY_LICENSES') / relative.removeprefix('node_modules/') / file.name
                copy(file, stage / target); files.append(target.as_posix())
        licenses.append({'package':relative.removeprefix('node_modules/'),'version':package.get('version'),'license':package.get('license'),'files':files})
    (stage / 'THIRD_PARTY_LICENSES').mkdir(exist_ok=True)
    (stage / 'THIRD_PARTY_LICENSES/index.json').write_text(json.dumps(licenses,ensure_ascii=False,indent=2), encoding='utf-8')

    documents = [(PORTABLE / 'docs/00-先读我.md'), (PORTABLE / 'docs/整体流程.md')]
    documents += sorted((PORTABLE / 'docs/交接').glob('*.md'))
    documents += [PORTABLE / 'docs/常见问题.md']
    text = '\n\n' + ('\n\n' + '=' * 70 + '\n\n').join(file.read_text(encoding='utf-8') for file in documents)
    (stage / '使用说明.txt').write_text(text, encoding='utf-8-sig')
    nav = ''.join(f'<a href="#doc-{i}">{html.escape(file.stem)}</a>' for i,file in enumerate(documents))
    sections = ''.join(f'<section id="doc-{i}">{render_markdown(file.read_text(encoding="utf-8"))}</section>' for i,file in enumerate(documents))
    help_html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TestPilot 前端使用与六人交接</title><style>
body{margin:0;background:#f9fafb;color:#111827;font:15px/1.75 system-ui,'Microsoft YaHei',sans-serif}header{padding:32px;background:#111827;color:white}header h1{margin:0;font-size:28px}main{max-width:1120px;margin:auto;padding:24px}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px}nav a{color:#4f46e5;background:white;border:1px solid #e5e7eb;border-radius:8px;padding:6px 12px;text-decoration:none}section{background:white;border:1px solid #e5e7eb;border-radius:12px;padding:28px;margin:24px 0;scroll-margin-top:16px}h2{font-size:24px}h3{font-size:19px}li{margin:8px 0}code{font-family:Consolas,monospace;background:#f3f4f6;padding:1px 5px;border-radius:4px}pre{white-space:pre-wrap;overflow:auto;background:#f3f4f6;padding:16px;border-radius:8px}pre code{padding:0}table{width:100%;border-collapse:collapse;font-size:13px}td{border:1px solid #e5e7eb;padding:10px;vertical-align:top}.table-wrap{overflow:auto}a:focus-visible{outline:3px solid #6366f1}@media(max-width:700px){header,main{padding:16px}section{padding:16px}h2{font-size:22px}}
</style><header><h1>TestPilot 前端使用与六人交接</h1><p>完整解压 → 双击启动前端.bat → 按自己的编号操作</p></header><main><nav>''' + nav + '</nav>' + sections + '</main></html>'
    (stage / '开始使用.html').write_text(help_html, encoding='utf-8')
    manifest = {'schemaVersion':1,'createdAt':now.isoformat(),'name':'TestPilot Frontend Portable','frontendOnly':True,'backendIncluded':False,
      'runtime':{**info,'sha256':digest(stage / 'runtime/node.exe'),'licenseSource':'https://raw.githubusercontent.com/nodejs/node/v26.12.1/LICENSE'},
      'defaultPort':5173,'defaultBackend':'http://127.0.0.1:8080','defaultPage':'/#/debug','source':'source/frontend','documents':[str(file.relative_to(PORTABLE)).replace('\\','/') for file in documents]}
    (stage / 'release-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2), encoding='utf-8')
    sums = ''.join(digest(file) + '  ' + file.relative_to(stage).as_posix() + '\n' for file in sorted(stage.rglob('*')) if file.is_file())
    (stage / 'SHA256SUMS.txt').write_text(sums, encoding='utf-8')
    with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as zipped:
        for file in sorted(stage.rglob('*')):
            if file.is_file(): zipped.write(file,Path(stage.name) / file.relative_to(stage))
    with zipfile.ZipFile(archive) as zipped:
        bad = zipped.testzip()
        if bad: raise SystemExit('压缩包完整性失败：' + bad)
        count = len(zipped.namelist())
    sha = digest(archive)
    archive.with_suffix('.zip.sha256').write_text(sha + '  ' + archive.name + '\n', encoding='utf-8')
    print('PACKAGE_RESULT ' + json.dumps({'archive':str(archive),'stage':str(stage),'sizeBytes':archive.stat().st_size,'files':count,'sha256':sha},ensure_ascii=False))

if __name__ == '__main__':
    main()
