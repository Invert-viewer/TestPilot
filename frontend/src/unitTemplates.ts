export type UnitConfig = { name: string; language: string; implementation: string; tests: string; timeoutMs: number };
export const unitTemplates: Record<string, { id: string; label: string; config: UnitConfig }[]> = {
  java: [
    { id: 'timeout', label: '请求超时边界', config: { name: '请求超时参数 · 边界测试', language: 'java', timeoutMs: 3000,
      implementation: `public class Subject {
    public static boolean validTimeout(int milliseconds) {
        return milliseconds >= 1 && milliseconds <= 60000;
    }
}`,
      tests: `import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SubjectTest {
    @Test
    void acceptsBoundaryValues() {
        assertTrue(Subject.validTimeout(1));
        assertTrue(Subject.validTimeout(60000));
    }

    @Test
    void rejectsValuesOutsideRange() {
        assertFalse(Subject.validTimeout(0));
        assertFalse(Subject.validTimeout(60001));
        assertFalse(Subject.validTimeout(-1));
    }
}` } },
    { id: 'percentile', label: 'P95 统计口径', config: { name: '响应时间分位数 · 最近秩法', language: 'java', timeoutMs: 3000,
      implementation: `import java.util.Arrays;

public class Subject {
    public static int p95(int[] samples) {
        if (samples.length == 0) {
            throw new IllegalArgumentException("没有样本");
        }
        int[] sorted = samples.clone();
        Arrays.sort(sorted);
        return sorted[(int) Math.ceil(sorted.length * 0.95) - 1];
    }
}`,
      tests: `import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SubjectTest {
    @Test
    void computesNearestRankWithoutMutatingInput() {
        int[] samples = {30, 10, 20};
        assertEquals(30, Subject.p95(samples));
        assertArrayEquals(new int[]{30, 10, 20}, samples);
    }

    @Test
    void rejectsMissingSamples() {
        assertThrows(IllegalArgumentException.class,
            () -> Subject.p95(new int[]{}));
    }
}` } },
  ],
  typescript: [
    { id: 'variables', label: '环境变量替换', config: { name: '请求变量替换 · 正常与缺失', language: 'typescript', timeoutMs: 3000,
      implementation: `export function resolveVariables(text: string, values: Record<string, string>) {
  return text.replace(/\{\{\\s*([^{}]+?)\\s*\}\}/g, (_, key) => {
    if (!Object.hasOwn(values, key)) throw new Error('未定义变量: ' + key);
    return values[key];
  });
}`,
      tests: `import { resolveVariables } from './subject';

test('替换 URL 中的环境变量', () => {
  expect(resolveVariables('{{baseUrl}}/users', {
    baseUrl: 'http://localhost:8080'
  })).toBe('http://localhost:8080/users');
});

test('缺失变量不能静默保留', () => {
  expect(() => resolveVariables('{{token}}', {}))
    .toThrow('未定义变量: token');
});` } },
    { id: 'async', label: '异步请求判定', config: { name: '异步响应 · 业务状态判定', language: 'typescript', timeoutMs: 3000,
      implementation: `export async function readResult(fetcher: () => Promise<{status: number}>) {
  const response = await fetcher();
  if (response.status >= 400) throw new Error('HTTP ' + response.status);
  return response.status;
}`,
      tests: `import { readResult } from './subject';

test('读取成功状态', async () => {
  await expect(readResult(async () => ({status: 200}))).resolves.toBe(200);
});

test('失败状态进入异常流程', async () => {
  await expect(readResult(async () => ({status: 500}))).rejects.toThrow('HTTP 500');
});` } },
  ],
};
