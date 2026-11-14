declare const numberFormatting: {
  formatTemperature(value: unknown, unavailable?: string): string;
  normalizeAssistantText(value: unknown): string;
  numberOptions(options?: Intl.NumberFormatOptions): Intl.NumberFormatOptions;
  dateOptions(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions;
};

export = numberFormatting;
