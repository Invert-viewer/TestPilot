package edu.xzit.testpilot.config;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "testpilot")
public class TestPilotProperties {

    private final Apifox apifox = new Apifox();

    public Apifox getApifox() {
        return apifox;
    }

    public static class Apifox {

        private String cliPath = "";
        private String shell = "cmd.exe";
        private String reportDir = "./data/reports";
        private int timeoutSeconds = 900;
        private List<SeedAsset> assets = new ArrayList<>();

        public String getCliPath() { return cliPath; }
        public void setCliPath(String cliPath) { this.cliPath = cliPath; }
        public String getShell() { return shell; }
        public void setShell(String shell) { this.shell = shell; }
        public String getReportDir() { return reportDir; }
        public void setReportDir(String reportDir) { this.reportDir = reportDir; }
        public int getTimeoutSeconds() { return timeoutSeconds; }
        public void setTimeoutSeconds(int timeoutSeconds) { this.timeoutSeconds = timeoutSeconds; }
        public List<SeedAsset> getAssets() { return assets; }
        public void setAssets(List<SeedAsset> assets) { this.assets = assets; }
    }

    public static class SeedAsset {

        private String id;
        private String name;
        private String tool = "APIFOX_CLI";
        private String kind = "APIFOX_SCENARIO";
        private String projectId;
        private String scenarioId;
        private String apifoxEnvironmentId;
        private String environmentName;
        private String siteUrl;
        private String scenarioKey;

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public String getTool() { return tool; }
        public void setTool(String tool) { this.tool = tool; }
        public String getKind() { return kind; }
        public void setKind(String kind) { this.kind = kind; }
        public String getProjectId() { return projectId; }
        public void setProjectId(String projectId) { this.projectId = projectId; }
        public String getScenarioId() { return scenarioId; }
        public void setScenarioId(String scenarioId) { this.scenarioId = scenarioId; }
        public String getApifoxEnvironmentId() { return apifoxEnvironmentId; }
        public void setApifoxEnvironmentId(String apifoxEnvironmentId) { this.apifoxEnvironmentId = apifoxEnvironmentId; }
        public String getEnvironmentName() { return environmentName; }
        public void setEnvironmentName(String environmentName) { this.environmentName = environmentName; }
        public String getSiteUrl() { return siteUrl; }
        public void setSiteUrl(String siteUrl) { this.siteUrl = siteUrl; }
        public String getScenarioKey() { return scenarioKey; }
        public void setScenarioKey(String scenarioKey) { this.scenarioKey = scenarioKey; }
    }
}
