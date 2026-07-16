import '@testing-library/jest-dom/vitest';

// jsdom не реализует scrollIntoView (используется, например, в AiBox для
// автопрокрутки к последнему сообщению) — подменяем no-op'ом на весь набор тестов.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
