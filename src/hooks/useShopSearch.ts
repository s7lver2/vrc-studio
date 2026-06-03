import { useEffect, useRef } from "react";
import { useShopStore } from "../store/shopStore";

export function useShopSearch() {
  const { query, search, setQuery } = useShopStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleQueryChange = (q: string) => {
    // Si el usuario pega una URL de Booth, normalizarla al ID numérico
    // para que fetchCombined pueda detectarla y hacer búsqueda directa.
    const boothUrlMatch = q.trim().match(/booth\.pm\/(?:[a-z]{2}\/)?items\/(\d+)/);
    const normalized = boothUrlMatch ? boothUrlMatch[1] : q;
    setQuery(normalized);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // ID numérico → buscar inmediatamente (sin debounce extra)
    const delay = boothUrlMatch ? 0 : 400;
    debounceRef.current = setTimeout(() => {
      if (normalized.trim()) search();
    }, delay);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { query, handleQueryChange };
}