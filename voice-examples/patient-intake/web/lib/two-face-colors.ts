import { rawColors } from '@/lib/raw-colors';
import type { RawColorName } from '@/lib/raw-colors';

// TWO FACE COLORS
export type TwoFaceColorName = keyof typeof rawColors;
export const twoFaceColors = {
  accent: {
    light: rawColors.blue['500'],
    dark: rawColors.cyan['400'],
  },
  accent2: {
    light: rawColors.blue['400'],
    dark: rawColors.cyan['600'],
  },
  purple: {
    light: rawColors.purple['400'],
    dark: rawColors.purple['300'],
  },
  purple2: {
    light: rawColors.purple['600'],
    dark: rawColors.purple['200'],
  },
  amber: {
    light: rawColors.amber['600'],
    dark: rawColors.amber['300'],
  },
  amber2: {
    light: rawColors.amber['300'],
    dark: rawColors.amber['600'],
  },
  green: {
    light: rawColors.green['600'],
    dark: rawColors.green['300'],
  },
  green2: {
    light: rawColors.green['400'],
    dark: rawColors.green['500'],
  },
  red: {
    light: rawColors.red['700'],
    dark: rawColors.red['500'],
  },

  yellow: {
    light: rawColors.yellow['700'],
    dark: rawColors.yellow['500'],
  },
  lime: {
    light: rawColors.lime['700'],
    dark: rawColors.lime['500'],
  },
  teal: {
    light: rawColors.teal['700'],
    dark: rawColors.teal['500'],
  },
  blue: {
    light: rawColors.blue['700'],
    dark: rawColors.blue['500'],
  },
  indigo: {
    light: rawColors.indigo['700'],
    dark: rawColors.indigo['500'],
  },
  violet: {
    light: rawColors.violet['700'],
    dark: rawColors.violet['500'],
  },
  pink: {
    light: rawColors.pink['700'],
    dark: rawColors.pink['500'],
  },
} satisfies Record<RawColorName | string, { light: string; dark: string }>;

// SEMANTIC COLORS
export type SemanticTwoFaceColorName = keyof typeof semanticColors;
export const semanticColors = {
  //foreground
  fg0: {
    light: rawColors.black,
    dark: rawColors.white,
  },
  fg1: {
    light: rawColors['gray-light']['900'],
    dark: rawColors['gray-dark']['100'],
  },
  fg2: {
    light: rawColors['gray-light']['800'],
    dark: rawColors['gray-dark']['200'],
  },
  fg3: {
    light: rawColors['gray-light']['700'],
    dark: rawColors['gray-dark']['300'],
  },
  fg4: {
    light: rawColors['gray-light']['600'],
    dark: rawColors['gray-dark']['400'],
  },
  fgAccentPrimary1: {
    light: rawColors.blue['500'],
    dark: rawColors.cyan['400'],
  },
  fgAccentPrimary2: {
    light: rawColors.blue['400'],
    dark: rawColors.cyan['600'],
  },
  fgAccentSecondary1: {
    light: rawColors.purple['600'],
    dark: rawColors.purple['300'],
  },
  fgAccentSecondary2: {
    light: rawColors.purple['400'],
    dark: rawColors.purple['500'],
  },
  fgSuccess: {
    light: rawColors.green['600'],
    dark: rawColors.green['300'],
  },
  fgModerate: {
    light: rawColors.amber['600'],
    dark: rawColors.amber['300'],
  },
  fgSerious1: {
    light: rawColors.red['600'],
    dark: rawColors.red['400'],
  },
  fgSerious2: {
    light: rawColors.red['500'],
    dark: rawColors.red['700'],
  },
  // model-type foregrounds (seeded from the inference pricing calculator)
  fgLLM: {
    light: rawColors.yellow['600'],
    dark: rawColors.yellow['500'],
  },
  fgSTT: {
    light: rawColors.green['500'],
    dark: rawColors.green['500'],
  },
  fgTTS: {
    light: rawColors.orange['500'],
    dark: rawColors.orange['500'],
  },
  //background
  bg0: {
    light: rawColors['white'],
    dark: rawColors['black'],
  },
  bg1: {
    light: rawColors['gray-light']['100'],
    dark: rawColors['gray-dark']['900'],
  },
  bg2: {
    light: rawColors['gray-light']['200'],
    dark: rawColors['gray-dark']['800'],
  },
  bg3: {
    light: rawColors['gray-light']['300'],
    dark: rawColors['gray-dark']['700'],
  },
  bgAccentPrimary1: {
    light: rawColors.blue['100'],
    dark: rawColors.cyan['900'],
  },
  bgAccentPrimary2: {
    light: rawColors.blue['200'],
    dark: rawColors.cyan['800'],
  },
  bgAccentSecondary1: {
    light: rawColors.purple['100'],
    dark: rawColors.purple['900'],
  },
  bgAccentSecondary2: {
    light: rawColors.purple['200'],
    dark: rawColors.purple['800'],
  },
  bgSuccess1: {
    light: rawColors.green['100'],
    dark: rawColors.green['900'],
  },
  bgSuccess2: {
    light: rawColors.green['200'],
    dark: rawColors.green['800'],
  },
  bgModerate1: {
    light: rawColors.amber['100'],
    dark: rawColors.amber['900'],
  },
  bgModerate2: {
    light: rawColors.amber['200'],
    dark: rawColors.amber['800'],
  },
  bgSerious1: {
    light: rawColors.red['100'],
    dark: rawColors.red['900'],
  },
  bgSerious2: {
    light: rawColors.red['200'],
    dark: rawColors.red['800'],
  },
  bgHistogramHover: {
    light: rawColors['gray-light']['300'],
    dark: rawColors['gray-dark']['500'],
  },
  // model-type backgrounds
  bgLLM: {
    light: rawColors.yellow['100'],
    dark: rawColors.yellow['900'],
  },
  bgSTT: {
    light: rawColors.green['100'],
    dark: rawColors.green['900'],
  },
  bgTTS: {
    light: rawColors.orange['100'],
    dark: rawColors.orange['900'],
  },

  //separator
  separator1: {
    light: rawColors['gray-light']['400'],
    dark: rawColors['gray-dark']['600'],
  },
  separator2: {
    light: rawColors['gray-light']['500'],
    dark: rawColors['gray-dark']['500'],
  },
  separatorAccentPrimary: {
    light: rawColors.blue['200'],
    dark: rawColors.cyan['800'],
  },
  separatorAccentSecondary1: {
    light: rawColors.purple['200'],
    dark: rawColors.purple['800'],
  },
  separatorAccentSecondary2: {
    light: rawColors.purple['300'],
    dark: rawColors.purple['700'],
  },
  separatorSuccess: {
    light: rawColors.green['200'],
    dark: rawColors.green['800'],
  },
  separatorModerate: {
    light: rawColors.amber['200'],
    dark: rawColors.amber['800'],
  },
  separatorSerious1: {
    light: rawColors.red['200'],
    dark: rawColors.red['800'],
  },
  separatorSerious2: {
    light: rawColors.red['300'],
    dark: rawColors.red['700'],
  },
  // model-type separators
  separatorLLM: {
    light: rawColors.yellow['200'],
    dark: rawColors.yellow['800'],
  },
  separatorSTT: {
    light: rawColors.green['200'],
    dark: rawColors.green['800'],
  },
  separatorTTS: {
    light: rawColors.orange['200'],
    dark: rawColors.orange['800'],
  },
} as const;

export type ChartTwoFaceColorName = keyof typeof chartColors;
export const chartColors = {
  chart1: {
    light: rawColors.blue['500'],
    dark: rawColors.cyan['400'],
  },
  chart2: {
    light: rawColors.purple['400'],
    dark: rawColors.purple['400'],
  },
  chart3: {
    light: rawColors.orange['500'],
    dark: rawColors.orange['500'],
  },
  chart4: {
    light: rawColors.purple['300'],
    dark: rawColors.purple['300'],
  },
  chart5: {
    light: rawColors.green['500'],
    dark: rawColors.green['500'],
  },
  chart6: {
    light: rawColors.cyan['400'],
    dark: rawColors.blue['400'],
  },
  chart7: {
    light: rawColors.yellow['600'],
    dark: rawColors.yellow['500'],
  },
  chart8: {
    light: rawColors.red['500'],
    dark: rawColors.red['500'],
  },
  chartSerious: {
    light: rawColors.red['600'],
    dark: rawColors.red['400'],
  },
  chartSuccess: {
    light: rawColors.green['600'],
    dark: rawColors.green['400'],
  },
  chartModerate: {
    light: rawColors.amber['600'],
    dark: rawColors.amber['300'],
  },
  chartNeutral: {
    light: rawColors['gray-light']['600'],
    dark: rawColors['gray-dark']['400'],
  },
} as const;

export type CodeTwoFaceColorName = keyof typeof codeColors;
export const codeColors = {
  codeAccent: {
    light: rawColors.blue['700'],
    dark: rawColors.cyan['500'],
  },
  codeAccent2: {
    light: rawColors.blue['500'],
    dark: rawColors.cyan['300'],
  },
  codePurple: {
    light: rawColors.purple['500'],
    dark: rawColors.purple['300'],
  },
  codePurple2: {
    light: rawColors.purple['700'],
    dark: rawColors.purple['200'],
  },
  codeAmber: {
    light: rawColors.amber['700'],
    dark: rawColors.amber['300'],
  },
  codeAmber2: {
    light: rawColors.amber['300'],
    dark: rawColors.amber['600'],
  },
  codeGreen: {
    light: rawColors.green['600'],
    dark: rawColors.green['300'],
  },
  codeGreen2: {
    light: rawColors.green['400'],
    dark: rawColors.green['500'],
  },
  codeRed: {
    light: rawColors.red['600'],
    dark: rawColors.red['300'],
  },
  codeRed2: {
    light: rawColors.red['400'],
    dark: rawColors.red['600'],
  },
} as const;

export const allTwoFaceColors = {
  ...twoFaceColors,
  ...semanticColors,
  ...chartColors,
  ...codeColors,
};
export type AllTwoFaceColorNames = keyof typeof allTwoFaceColors;

// HELPER FUNCTIONS
export function twoFaceColorsToTailwindDefinitions<T extends string>(
  colors: Record<T, { light: string; dark: string }>,
) {
  const definitions = Object.keys(colors).reduce<Partial<Record<T, string>>>((acc, colorName) => {
    const css = `oklch(var(--lk-color-${colorName}) / <alpha-value>)` as const;
    return {
      ...acc,
      [colorName]: css,
    };
  }, {});

  return definitions;
}

export function colorForTheme(colorName: AllTwoFaceColorNames, theme: 'light' | 'dark') {
  return allTwoFaceColors[colorName][theme];
}
