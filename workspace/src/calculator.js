/**
 * 修复后的计算与折扣模块 (由 Coder Worker 自愈生成)
 */
export function calculateDiscount(price, discountPercent) {
  if (price < 0 || discountPercent < 0) {
    throw new Error('Negative values not allowed');
  }

  // ✅ 修正计算公式：折扣为 price * (1 - discountPercent / 100)
  const finalPrice = price * (1 - discountPercent / 100);

  return Math.round(finalPrice * 100) / 100;
}

export function divide(a, b) {
  // ✅ 修正边界条件：除数为 0 保护拦截
  if (b === 0) {
    throw new Error('Division by zero is not permitted');
  }
  return a / b;
}
