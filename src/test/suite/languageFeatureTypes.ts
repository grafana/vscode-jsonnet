import {
  ComparablePosition,
  ComparableRange,
} from './lspTestUtils';

export type PositionLike = ComparablePosition;
export type RangeLike = ComparableRange;

export type ComparableLocation = {
  uri: string;
  range: RangeLike;
};

export type ComparableEdit = {
  range: RangeLike;
  newText: string;
};

export type ComparableWorkspaceEdit = {
  changes: Record<string, ComparableEdit[]>;
};

export type ComparableHover = {
  contents: string[];
};

export type ComparableCodeAction = {
  title: string;
  kind: string | null;
  isPreferred: boolean;
  edit: ComparableWorkspaceEdit | null;
};
