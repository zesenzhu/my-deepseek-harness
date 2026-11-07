/**
 * 【基线文件 / 故意留 Bug，请勿手工修复】
 * reset-workspace 会把本文件原样复制为 src/calculator.js。
 * 修复演示通过 Agent 修改 src/calculator.js 完成，而不是改这里。
 *
 * 埋设的两个 Bug：
 *  1. 折扣方向反了：1 + discountPercent / 100（应为 1 - discountPercent / 100）
 *  2. divide 缺少除零保护，返回 Infinity 而不是抛错
 */
export function calculateDiscount(price, discountPercent) {
  if (price < 0 || discountPercent < 0) {
    throw new Error('Negative values not allowed');
  }

  // ❌ BUG: 折扣方向反了
  const finalPrice = price * (1 + discountPercent / 100);

  return Math.round(finalPrice * 100) / 100;
}

export function divide(a, b) {
  // ❌ BUG: 未拦截除零
  return a / b;
}
