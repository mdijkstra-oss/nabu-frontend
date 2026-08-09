interface VariantMatrixOptions<Variant extends string, Size extends string, Props> {
  variants: readonly Variant[]
  sizes: readonly Size[]
  propsFor: (variant: Variant, size: Size) => Props
  cellClassName?: (variant: Variant, size: Size) => string
  gridClassName?: string
}

export function renderVariantMatrix<Variant extends string, Size extends string, Props extends object>(
  Component: React.ComponentType<Props>,
  {
    variants,
    sizes,
    propsFor,
    cellClassName,
    gridClassName = "grid w-fit items-center gap-2",
  }: VariantMatrixOptions<Variant, Size, Props>
) {
  return (
    <div
      className={gridClassName}
      style={{ gridTemplateColumns: `repeat(${sizes.length}, auto)` }}
    >
      {variants.flatMap((variant) =>
        sizes.map((size) => {
          const key = `${variant}-${size}`
          const props = propsFor(variant, size)
          if (!cellClassName) return <Component key={key} {...props} />
          return (
            <div key={key} className={cellClassName(variant, size)}>
              <Component {...props} />
            </div>
          )
        })
      )}
    </div>
  )
}
