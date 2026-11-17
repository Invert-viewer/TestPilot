import fs from 'node:fs';
import { createRequire } from 'node:module';
import { findJava, jmeterPath, junitPath, junitVersion, runProcess, runtimeCapabilities } from './runtime.mjs';
import { browserPath, availableBrowsers } from './browser.mjs';
const require=createRequire(import.meta.url);
function packageInfo(name) { try { const location=require.resolve(name+'/package.json'); const pkg=JSON.parse(fs.readFileSync(location,'utf8')); return {available:true,version:pkg.version,path:location}; } catch { return {available:false,version:'',path:''}; } }
export async function toolchain() {
  const caps=await runtimeCapabilities(), java=findJava(), jar=jmeterPath();
  let jmeterVersion='',jmeterError='';
  if(jar&&caps.java) try { const v=await runProcess(java.java,['-jar',jar,'-v'],{timeoutMs:12000}); jmeterVersion=/\b5\.\d+(?:\.\d+)?\b/.exec(v.output)?.[0] || ''; if(v.code!==0) jmeterError='版本探测失败，请检查 Java 和 JMeter 安装'; } catch(e) { jmeterError=e.message; }
  return { node:process.version,platform:process.platform,browsers:availableBrowsers(),tools:[
    {id:'jmeter',name:'Apache JMeter',purpose:'性能测试',available:Boolean(jar&&caps.java&&!jmeterError),version:jmeterVersion,path:jar||'',detail:jmeterError||'非 GUI 执行 JMX，解析原始 JTL / CSV，网页显示 TPS、P95 和错误率',href:'#/perf'},
    {id:'newman',name:'Postman Newman',purpose:'接口集合回归',...packageInfo('newman'),detail:'实际执行 Postman Collection；沿用接口断言与环境提取',href:'#/api'},
    {id:'playwright',name:'Playwright',purpose:'UI 自动化 / 兼容性',...packageInfo('playwright'),available:Boolean(browserPath()),path:browserPath()||'',detail:'使用服务器安装的浏览器；多视口、页面检查与失败截图',href:'#/ui'},
    {id:'java',name:'Java / JUnit',purpose:'Java 单元测试',available:caps.java&&fs.existsSync(junitPath),version:javaVersion(caps)+' · JUnit '+junitVersion,path:junitPath,detail:'javac 编译并通过 JUnit Console 执行；展示断言、堆栈与 XML 报告',href:'#/unit'},
    {id:'vitest',name:'Vitest',purpose:'TypeScript 单元测试',...packageInfo('vitest'),detail:'独立进程运行 TypeScript 实现与断言',href:'#/unit'},
    {id:'security',name:'HTTP 安全基线',purpose:'安全测试',available:true,version:process.version,path:process.execPath,detail:'现有 HTTP 执行器检查安全响应头、Cookie、CORS 与信息暴露；不是完整漏洞扫描器',href:'#/security'},
  ]};
}
function javaVersion(caps) { return caps.javaVersion || 'Java 不可用'; }
