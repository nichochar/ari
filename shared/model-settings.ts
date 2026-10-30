export const reasoningEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type ReasoningEffort = typeof reasoningEfforts[number];
export interface ModelSelection { model: string; reasoningEffort: ReasoningEffort; }
export interface ModelOption {
  id: string; name: string; efforts: ReasoningEffort[]; defaultEffort: ReasoningEffort;
}
export interface ModelSettingsView { selection: ModelSelection; models: ModelOption[]; }
export const defaultModelSelection: ModelSelection = { model: 'gpt-6-astra', reasoningEffort: 'high' };
