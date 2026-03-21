"use client";

const CATEGORIES = ["Crypto", "Stocks", "ETFs", "Indices", "FX", "Commodities", "Macro"] as const;

type MarketsFilterProps = {
  selected: string[];
  onChange: (next: string[]) => void;
};

export function MarketsFilter({ selected, onChange }: MarketsFilterProps) {
  return (
    <aside className="panel markets-filter-panel">
      <header className="panel-header">
        <h2>Asset Classes</h2>
        <span>Filter</span>
      </header>
      <div className="mt-3 space-y-2">
        {CATEGORIES.map((category) => {
          const checked = selected.includes(category);
          return (
            <label key={category} className="market-check-row">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  if (event.target.checked) {
                    onChange([...selected, category]);
                  } else {
                    onChange(selected.filter((item) => item !== category));
                  }
                }}
              />
              <span>{category}</span>
            </label>
          );
        })}
      </div>
    </aside>
  );
}
