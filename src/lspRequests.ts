import { RequestType } from 'vscode-languageclient/node';

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type EvalFileParams = {
  textDocument: {
    uri: string;
  };
};

export type EvalExpressionParams = {
  expression: string;
  baseDocument?: {
    uri: string;
  };
};

export type FindTransitiveImportersParams = {
  textDocument: {
    uri: string;
  };
};

export type FindTransitiveImportersResponse = {
  file: string;
  transitiveImporters: string[];
};

export const EvalFileRequest = new RequestType<EvalFileParams, JsonValue, void>('jrsonnet/evalFile');
export const EvalExpressionRequest = new RequestType<EvalExpressionParams, JsonValue, void>('jrsonnet/evalExpression');
export const FindTransitiveImportersRequest = new RequestType<
  FindTransitiveImportersParams,
  FindTransitiveImportersResponse,
  void
>('jrsonnet/findTransitiveImporters');
