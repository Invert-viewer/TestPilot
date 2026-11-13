@echo off
setlocal
cd /d "%~dp0"
if not defined JAVA_HOME (
 echo Set JAVA_HOME to JDK 21 first.
 pause
 exit /b 1
)
if not exist "frontend\dist\index.html" (
 echo Build frontend first: cd frontend, npm ci, npm run build
 pause
 exit /b 1
)
if not exist "target\TestPilot-0.0.1-SNAPSHOT.jar" (
 echo Build backend first: mvnw.cmd package
 pause
 exit /b 1
)
"%JAVA_HOME%\bin\java.exe" -jar "target\TestPilot-0.0.1-SNAPSHOT.jar" "--spring.web.resources.static-locations=file:./frontend/dist/" "--server.address=0.0.0.0"
if errorlevel 1 pause
