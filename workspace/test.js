import assert from 'assert';
import { calculateDiscount, divide } from './src/calculator.js';

console.log('🧪 正在执行沙箱回归测试...');

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

it('应该正确计算 20% 折扣后的价格', () => {
  const result = calculateDiscount(100, 20);
  assert.strictEqual(result, 80, `期望折扣后价格为 80，但实际得到: ${result}`);
});

it('应该正确计算 50% 折扣后的价格', () => {
  const result = calculateDiscount(200, 50);
  assert.strictEqual(result, 100, `期望折扣后价格为 100，但实际得到: ${result}`);
});

it('除数为零时应当抛出特定错误', () => {
  assert.throws(
    () => divide(10, 0),
    /Division by zero/,
    '未对除以零进行防护拦截！'
  );
});

console.log(`\n测试统计: ${passed} 通过, ${failed} 失败.`);
if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

