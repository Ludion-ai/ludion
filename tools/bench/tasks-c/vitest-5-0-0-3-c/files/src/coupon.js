const COUPONS = {
  SAVE10: { percent: 10, expires: "2030-12-31" },
  OLD5: { percent: 5, expires: "2020-01-31" },
};

// Looks the code up like the coupon service does (async), then applies it to the total in cents.
export async function applyCoupon(total, code, now = new Date()) {
  const coupon = COUPONS[code.toUpperCase()];
  if (!coupon) throw new Error(`Unknown coupon: ${code}`);
  if (now > new Date(`${coupon.expires}T23:59:59Z`)) throw new Error(`Coupon expired: ${code}`);
  return Math.round(total * (100 - coupon.percent)) / 100;
}
