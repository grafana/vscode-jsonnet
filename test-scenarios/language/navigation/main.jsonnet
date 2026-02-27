local lib = import './lib.libsonnet';
local answer = lib.foo(41);
{
  answer: answer,
  again: answer,
}
