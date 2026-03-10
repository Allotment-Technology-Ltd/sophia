export type PaddleCheckoutMode = 'redirect' | 'overlay' | 'inline';
export type PaddleCheckoutTheme = 'light' | 'dark' | null;

export interface PaddleCheckoutPresentation {
  mode: PaddleCheckoutMode;
  locale: string | null;
  theme: PaddleCheckoutTheme;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function parseMode(raw: string | undefined): PaddleCheckoutMode {
  const value = raw?.trim().toLowerCase();
  if (value === 'inline') return 'inline';
  if (value === 'overlay') return 'overlay';
  return 'redirect';
}

function parseTheme(raw: string | undefined): PaddleCheckoutTheme {
  const value = raw?.trim().toLowerCase();
  if (value === 'dark') return 'dark';
  if (value === 'light') return 'light';
  return null;
}

export function getCheckoutPresentation(): PaddleCheckoutPresentation {
  return {
    mode: parseMode(
      firstNonEmpty(
        process.env.PADDLE_CHECKOUT_MODE,
        process.env.PUBLIC_PADDLE_CHECKOUT_MODE
      )
    ),
    locale: firstNonEmpty(
      process.env.PADDLE_CHECKOUT_LOCALE,
      process.env.PUBLIC_PADDLE_CHECKOUT_LOCALE
    ) ?? null,
    theme: parseTheme(
      firstNonEmpty(
        process.env.PADDLE_CHECKOUT_THEME,
        process.env.PUBLIC_PADDLE_CHECKOUT_THEME
      )
    )
  };
}
