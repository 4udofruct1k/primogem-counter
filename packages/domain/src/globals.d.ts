// structuredClone есть и в браузерах, и в Node ≥ 17; lib.dom / @types/node в domain не подключаются.
declare function structuredClone<T>(value: T): T;
