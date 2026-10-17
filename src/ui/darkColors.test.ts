import { describe, expect, it } from 'vitest';
import { darkColor, darkColors } from './darkColors';

describe('darkColor', () => {
  it('turns dark text light and light backgrounds dark', () => {
    expect(darkColor('black', false)).toBe('#eeeeee');
    expect(darkColor('#000', false)).toBe('#eeeeee');
    expect(darkColor('white', true)).toBe('#161616');
    expect(darkColor('#FFFFFF', true)).toBe('#161616');
  });

  it('keeps the hue', () => {
    expect(darkColor('#325592', false)).toBe('#9bc0ff');
    expect(darkColor('red', false)).toBe('#ff8574');
    expect(darkColor('#ffe6e6', true)).toBe('#2c1b1b');
  });

  it('keeps vivid backgrounds visible', () => {
    expect(darkColor('yellow', true)).toBe('#464600');
  });

  it('leaves light text and dark backgrounds as they are', () => {
    expect(darkColor('white', false)).toBe('white');
    expect(darkColor('#600000', true)).toBe('#600000');
  });

  it('keeps the alpha and leaves what it cannot read alone', () => {
    expect(darkColor('rgb(255 255 255 / 50%)', true)).toBe('rgb(22 22 22 / 0.5)');
    expect(darkColor('rgba(0, 0, 0, 0.25)', false)).toBe('rgb(238 238 238 / 0.25)');
    expect(darkColor('rgb(10% 10% 10%)', false)).toBe('rgb(10% 10% 10%)');
  });
});

describe('darkColors', () => {
  it('rewrites colour declarations, as text or background colours', () => {
    const css = 'span.a {\n    color: #000000;\n    background: yellow;\n}\ntd { border-top: 1px solid black; background-color: #FFF }';
    expect(darkColors(css)).toBe(
      'span.a {\n    color: #eeeeee;\n    background: #464600;\n}\ntd { border-top: 1px solid #eeeeee; background-color: #161616 }',
    );
  });

  it('leaves other declarations, custom properties and selectors alone', () => {
    const css = 'p.red { --docx-color: black; font-family: Arial; color: inherit } .white-x { margin: 0 }';
    expect(darkColors(css)).toBe(css);
  });

  it('works on a style attribute', () => {
    expect(darkColors('color: red; font-size: 0.65em')).toBe('color: #ff8574; font-size: 0.65em');
  });
});
