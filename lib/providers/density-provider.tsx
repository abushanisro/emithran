'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type Density = 'comfortable' | 'compact';

const STORAGE_KEY = 'mithran-density';

interface DensityContextType {
  density: Density;
  setDensity: (d: Density) => void;
}

const DensityContext = createContext<DensityContextType>({
  density: 'comfortable',
  setDensity: () => {},
});

export function DensityProvider({ children }: { children: React.ReactNode }) {
  const [density, setDensityState] = useState<Density>('comfortable');

  // Hydrate from localStorage on mount
  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as Density | null) ?? 'comfortable';
    applyDensity(saved);
    setDensityState(saved);
  }, []);

  const setDensity = (d: Density) => {
    setDensityState(d);
    localStorage.setItem(STORAGE_KEY, d);
    applyDensity(d);
  };

  return (
    <DensityContext.Provider value={{ density, setDensity }}>
      {children}
    </DensityContext.Provider>
  );
}

function applyDensity(d: Density) {
  if (d === 'compact') {
    document.documentElement.classList.add('compact');
  } else {
    document.documentElement.classList.remove('compact');
  }
}

export const useDensity = () => useContext(DensityContext);
