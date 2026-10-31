export interface TickStep {
  major: number;
  minor: number;
  format(index: number): string;
}

const minus = '−';
const piFractions = [[1, 12], [1, 6], [1, 4], [1, 3], [1, 2], [1, 1], [2, 1], [5, 1], [10, 1]] as const;

const signed = (text: string) => text.replace('-', minus);

export function decimalStep(minimum: number): TickStep {
  const exponent = Math.floor(Math.log10(minimum));
  const base = 10 ** exponent;
  const mantissa = [1, 2, 5, 10].find(candidate => candidate * base >= minimum * (1 - 1e-9)) ?? 10;
  const normalized = mantissa === 10 ? 1 : mantissa;
  const power = mantissa === 10 ? exponent + 1 : exponent;
  const major = normalized * 10 ** power;
  return {
    major,
    minor: major / (normalized === 2 ? 4 : 5),
    format: index => formatMultiple(index * normalized, power),
  };
}

function formatMultiple(units: number, power: number): string {
  if (units === 0) return '0';
  const magnitude = Math.log10(Math.abs(units)) + power;
  if (magnitude >= 6 || power <= -6) {
    const digits = String(Math.abs(units)).replace(/0+$/, '');
    const exponent = power + String(Math.abs(units)).length - 1;
    const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${units < 0 ? minus : ''}${mantissa}×10${superscript(exponent)}`;
  }
  if (power >= 0) return signed(`${units}${'0'.repeat(power)}`);
  const digits = String(Math.abs(units)).padStart(-power + 1, '0');
  const text = `${digits.slice(0, power)}.${digits.slice(power)}`.replace(/\.?0+$/, '');
  return `${units < 0 ? minus : ''}${text}`;
}

function superscript(value: number): string {
  const digits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return String(value).replace('-', '⁻').replace(/\d/g, digit => digits[Number(digit)]);
}

export function piStep(minimum: number): TickStep {
  const fraction = piFractions.find(([numerator, denominator]) => Math.PI * numerator / denominator >= minimum);
  if (!fraction) {
    const multiple = decimalStep(minimum / Math.PI);
    return { major: multiple.major * Math.PI, minor: multiple.minor * Math.PI, format: index => piLabel(multiple.format(index)) };
  }
  const [numerator, denominator] = fraction;
  const major = Math.PI * numerator / denominator;
  if (major > 3 * minimum) return decimalStep(minimum);
  return {
    major,
    minor: major / (denominator > 1 ? 2 : numerator === 5 ? 5 : 4),
    format: index => piFraction(index * numerator, denominator),
  };
}

function piLabel(multiple: string): string {
  if (multiple === '0') return '0';
  if (multiple === '1') return 'π';
  if (multiple === `${minus}1`) return `${minus}π`;
  return `${multiple}π`;
}

function piFraction(numerator: number, denominator: number): string {
  if (numerator === 0) return '0';
  const divisor = gcd(Math.abs(numerator), denominator);
  const top = numerator / divisor, bottom = denominator / divisor;
  return `${piLabel(top === 1 ? '1' : top === -1 ? `${minus}1` : signed(String(top)))}${bottom === 1 ? '' : `/${bottom}`}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export class StepChooser {
  private step: TickStep | null = null;

  constructor(private readonly pi: boolean, private readonly target = 80, private readonly band: [number, number] = [50, 160]) {}

  choose(pixelsPerUnit: number): TickStep {
    const spacing = this.step ? this.step.major * pixelsPerUnit : 0;
    if (!this.step || spacing < this.band[0] || spacing > this.band[1]) {
      const minimum = this.target / pixelsPerUnit;
      this.step = this.pi ? piStep(minimum) : decimalStep(minimum);
    }
    return this.step;
  }
}
