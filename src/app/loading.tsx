export default function GlobalLoading() {
  return (
    <div className="flex-1 min-h-[50vh] flex flex-col items-center justify-center py-12 px-6">
      <div className="flex flex-col items-center gap-3">
        {/* Premium Emerald Spinner */}
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-4 border-emerald-100" />
          <div className="absolute inset-0 rounded-full border-4 border-emerald-600 border-t-transparent animate-spin" />
        </div>
        <p className="text-sm font-semibold text-emerald-800 animate-pulse tracking-wide">
          Carregando...
        </p>
      </div>
    </div>
  )
}
