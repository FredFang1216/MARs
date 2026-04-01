import type { MetricsJson } from './types'

interface Props {
  metrics: MetricsJson
}

export default function MetricsTable({ metrics }: Props) {
  const models = Object.entries(metrics.models)
  if (models.length === 0) return null

  // Collect all metric keys across all models
  const allOosKeys = new Set<string>()
  const allIsKeys = new Set<string>()
  for (const [, data] of models) {
    if (data.out_of_sample) Object.keys(data.out_of_sample).forEach(k => allOosKeys.add(k))
    if (data.in_sample) Object.keys(data.in_sample).forEach(k => allIsKeys.add(k))
  }

  // Find best value per metric (lowest assumed better for loss-like, context-dependent)
  const oosValues = new Map<string, { min: number; max: number }>()
  for (const key of allOosKeys) {
    let min = Infinity, max = -Infinity
    for (const [, data] of models) {
      const v = data.out_of_sample?.[key]
      if (typeof v === 'number') {
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    oosValues.set(key, { min, max })
  }

  return (
    <div className="space-y-3">
      {/* Out-of-sample (primary) */}
      {allOosKeys.size > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Out-of-Sample</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-1.5 pr-3 text-gray-500 font-medium">Model</th>
                  {[...allOosKeys].map(k => (
                    <th key={k} className="text-right py-1.5 px-2 text-gray-500 font-medium font-mono">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {models.map(([model, data]) => (
                  <tr key={model} className="border-b border-gray-800/50">
                    <td className="py-1.5 pr-3 text-gray-300 font-medium">{model}</td>
                    {[...allOosKeys].map(k => {
                      const v = data.out_of_sample?.[k]
                      const range = oosValues.get(k)
                      const isBest = range && typeof v === 'number' && v === range.min && range.min !== range.max
                      return (
                        <td key={k} className={`text-right py-1.5 px-2 font-mono ${
                          isBest ? 'text-accent-green font-semibold' : 'text-gray-400'
                        }`}>
                          {typeof v === 'number' ? v.toFixed(4) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* In-sample (secondary, collapsed by default) */}
      {allIsKeys.size > 0 && (
        <details className="group">
          <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 transition-colors">
            In-Sample Metrics
          </summary>
          <div className="overflow-x-auto mt-1.5">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-1.5 pr-3 text-gray-500 font-medium">Model</th>
                  {[...allIsKeys].map(k => (
                    <th key={k} className="text-right py-1.5 px-2 text-gray-500 font-medium font-mono">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {models.map(([model, data]) => (
                  <tr key={model} className="border-b border-gray-800/50">
                    <td className="py-1.5 pr-3 text-gray-300 font-medium">{model}</td>
                    {[...allIsKeys].map(k => {
                      const v = data.in_sample?.[k]
                      return (
                        <td key={k} className="text-right py-1.5 px-2 font-mono text-gray-500">
                          {typeof v === 'number' ? v.toFixed(4) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Statistical tests */}
      {metrics.statistical_tests && Object.keys(metrics.statistical_tests).length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Statistical Tests</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-1.5 pr-3 text-gray-500 font-medium">Test</th>
                  <th className="text-right py-1.5 px-2 text-gray-500 font-medium">Statistic</th>
                  <th className="text-right py-1.5 px-2 text-gray-500 font-medium">p-value</th>
                  <th className="text-center py-1.5 px-2 text-gray-500 font-medium">Sig@5%</th>
                  <th className="text-left py-1.5 px-2 text-gray-500 font-medium">Direction</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(metrics.statistical_tests).map(([name, test]) => (
                  <tr key={name} className="border-b border-gray-800/50">
                    <td className="py-1.5 pr-3 text-gray-300 font-medium">{name}</td>
                    <td className="text-right py-1.5 px-2 font-mono text-gray-400">{test.statistic.toFixed(4)}</td>
                    <td className={`text-right py-1.5 px-2 font-mono ${
                      test.p_value < 0.05 ? 'text-accent-green' : 'text-gray-400'
                    }`}>
                      {test.p_value.toFixed(4)}
                    </td>
                    <td className="text-center py-1.5 px-2">
                      {test.significant_5pct
                        ? <span className="text-accent-green">Yes</span>
                        : <span className="text-gray-600">No</span>
                      }
                    </td>
                    <td className="text-left py-1.5 px-2 text-gray-400">{test.direction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
