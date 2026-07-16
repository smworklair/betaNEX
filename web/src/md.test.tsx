import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Md } from './md';

describe('Md — лёгкий markdown-рендер ответов NEX', () => {
  it('рендерит инлайн-разметку: жирный, курсив, код', () => {
    render(<Md text="**жирный** и *курсив* и `код`" />);
    expect(screen.getByText('жирный').tagName).toBe('STRONG');
    expect(screen.getByText('курсив').tagName).toBe('EM');
    expect(screen.getByText('код').tagName).toBe('CODE');
  });

  it('рендерит маркированный список как <ul><li>', () => {
    const { container } = render(<Md text={'- первое\n- второе\n- третье'} />);
    const items = container.querySelectorAll('ul.md-ul li');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('первое');
    expect(items[2]).toHaveTextContent('третье');
  });

  it('рендерит нумерованный список как <ol><li>', () => {
    const { container } = render(<Md text={'1. шаг один\n2. шаг два'} />);
    const items = container.querySelectorAll('ol.md-ol li');
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveTextContent('шаг два');
  });

  it('рендерит заголовок как div.md-h', () => {
    const { container } = render(<Md text="## Заголовок раздела" />);
    const h = container.querySelector('.md-h');
    expect(h).toHaveTextContent('Заголовок раздела');
  });

  it('рендерит горизонтальную черту как <hr>', () => {
    const { container } = render(<Md text={'абзац\n\n---\n\nещё абзац'} />);
    expect(container.querySelector('hr.md-hr')).toBeInTheDocument();
  });

  it('склеивает последовательные строки абзаца через пробел', () => {
    const { container } = render(<Md text={'первая строка\nвторая строка'} />);
    const p = container.querySelector('p.md-p');
    expect(p).toHaveTextContent('первая строка вторая строка');
  });

  it('пропускает пустые строки между блоками', () => {
    const { container } = render(<Md text={'абзац один\n\n\nабзац два'} />);
    const paragraphs = container.querySelectorAll('p.md-p');
    expect(paragraphs).toHaveLength(2);
  });
});
