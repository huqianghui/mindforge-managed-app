// 从洞察页、建议页跳到问答页：q 只预填输入框（不自动发送，用户可先选后端、改问题），
// doc 把相关文章固定为第一条资料。路由见 App.tsx 的 #/ask?q=&doc=。
export function askHref(question: string, doc?: string): string {
  const qs = new URLSearchParams({ q: question });
  if (doc) qs.set('doc', doc);
  return `#/ask?${qs.toString()}`;
}
