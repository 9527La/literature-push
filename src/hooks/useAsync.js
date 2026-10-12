import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 异步数据三态hook（S3）。
 *
 * 六个视图过去各自实现 loading/error/empty 三态，行为不一致：有的静默
 * catch、有的用裸 div、有的没有重试入口。这里收敛为一处：skeleton 由调用
 * 方给（形状匹配真实内容，CLS≈0），error 保留旧数据并给重试，empty 走
 * EmptyState。
 *
 * fetcher 必须是稳定的（useCallback 或模块级函数）；deps 变化即重新请求。
 */
export default function useAsync(fetcher, deps = [], { initialData = null } = {}) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError("");
    Promise.resolve()
      .then(() => fetcherRef.current())
      .then((result) => {
        if (ignore) return;
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (ignore) return;
        setError(err?.message || String(err));
        setLoading(false);
      });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload, setData };
}
