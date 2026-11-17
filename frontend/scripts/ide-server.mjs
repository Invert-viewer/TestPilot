import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

// Started directly by the JVM. No shell, npm command, or IDE Node plugin is needed.
const root=fileURLToPath(new URL('../',import.meta.url));
let port=Number(process.env.TESTPILOT_FRONTEND_PORT || 5174);
if(port===0) {
  const reservation=net.createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
}
const parent=Number(process.env.TESTPILOT_PARENT_PID);
const token=process.env.TESTPILOT_IDE_CONTROL_TOKEN;
if(!token || !Number.isInteger(parent) || parent<1) throw new Error('请从 IDEA 运行 TestPilotApplication 启动此服务');
let server,closing=false,parentMonitor;
async function shutdown() {
  if(closing)return; closing=true;clearInterval(parentMonitor);
  const deadline=setTimeout(()=>process.exit(1),8000); deadline.unref();
  try {
    const plugin=server?.config.plugins.find(p=>p.name==='testpilot-local-execution');
    await plugin?.api?.shutdown();
    await server?.close();
    clearTimeout(deadline); process.exit(0);
  } catch {process.exit(1);}
}
const lifecycle={name:'testpilot-idea-lifecycle',configureServer(vite){
  vite.middlewares.use((req,res,next)=>{
    if(req.url!=='/__ide/stop')return next();
    if(req.method!=='POST'||req.headers['x-testpilot-control']!==token){res.writeHead(403);return res.end();}
    res.writeHead(202);res.end('stopping');setImmediate(shutdown);
  });
}};
try {
  server=await createServer({root,configFile:path.join(root,'vite.config.ts'),plugins:[lifecycle],server:{host:'127.0.0.1',port,strictPort:true,open:false}});
  await server.listen();
  const address=server.httpServer.address();
  process.stdout.write('TESTPILOT_IDE_READY '+JSON.stringify({port:address.port})+'\n');
  parentMonitor=setInterval(()=>{try{process.kill(parent,0);}catch(error){if(error.code==='ESRCH')shutdown();}},1000);
} catch(error) {console.error('前端启动失败：'+error.message);await shutdown();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
