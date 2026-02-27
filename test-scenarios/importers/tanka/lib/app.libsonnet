local imported = import '../../jsonnet/lib/imported.libsonnet';

{
  kind: "tanka",
  environment: "default",
  value: imported.value,
}
