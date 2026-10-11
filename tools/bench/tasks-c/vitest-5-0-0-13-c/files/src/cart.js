import { total } from './price.js';

export function checkout(cart) {
  if (cart.items.length === 0) throw new Error('Your cart is empty');
  return { charged: total(cart.items), items: cart.items.length };
}

export function moveToCart(wishlist, cart) {
  return { wishlist: { items: [] }, cart: { items: [...cart.items, ...wishlist.items] } };
}
