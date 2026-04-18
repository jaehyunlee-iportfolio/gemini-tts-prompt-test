export type PromptRevision = {
  version: string;
  long: string;
  short?: string;
  changelog?: string;
  createdAt?: string;
};

export type RegistryPrompt = {
  id: string;
  title: string;
  revisions?: PromptRevision[];
};

export type RegistryGroup = {
  id: string;
  title: string;
  prompts: RegistryPrompt[];
};

export type PromptRegistryJson = {
  schemaVersion?: number;
  registryVersion?: number;
  updatedAt?: string;
  groups?: RegistryGroup[];
};
