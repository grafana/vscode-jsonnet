local x = 1;
local f = function(x) x + x;
{
  outer: x,
  inner: f(2),
}
