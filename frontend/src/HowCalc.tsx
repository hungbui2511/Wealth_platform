// Nút "Cách tính" (FR-604): công thức, dòng nhận định được dùng, u, giá trị, tỷ lệ sở hữu của từng vị thế
import { Modal, Money, fmtPct } from './ui'

const RULE: Record<string, string> = { instrument: 'Dòng mã', sector: 'Dòng ngành (cùng loại tài sản)', asset_class: 'Dòng loại tài sản', none: 'Không có dòng' }

export function HowCalcModal({ result, onClose, focus }: { result: any; onClose: () => void; focus?: string }) {
  const rows = result.positions.filter((p: any) => !focus || p.holding_id === focus)
  return (
    <Modal title={`Cách tính – ${result.family_id}`} onClose={onClose} wide>
      <p className="text-[13px] text-fgm mb-2">Tác động = Σ phơi nhiễm × (cú sốc tài sản + cú sốc tỷ giá). Phơi nhiễm = giá trị quy đổi VND × tỷ lệ sở hữu hiệu dụng. Cú sốc tài sản = mức của dòng được chọn (mã &gt; ngành &gt; loại tài sản) × u của loại tài sản của vị thế; cú sốc tỷ giá = mức dòng fx × u_fx. Cộng hai cú sốc là xấp xỉ bậc một.</p>
      <div className="overflow-x-auto">
        <table className="t">
          <thead><tr><th>Vị thế</th><th>Loại / ngành / tiền</th><th className="num">Giá trị VND</th><th className="num">Sở hữu</th><th className="num">Phơi nhiễm</th><th>Dòng được chọn</th><th className="num">u</th><th className="num">Cú sốc TS</th><th>Dòng fx</th><th className="num">Cú sốc fx</th><th className="num">Tác động</th></tr></thead>
          <tbody>{rows.map((p: any, i: number) => (
            <tr key={i}>
              <td><div className="mono">{p.instrument_id}{p.part !== null ? ` (phần ${Number(p.part) + 1})` : ''}</div><div className="text-fgm text-xs">{p.instrument_name}</div></td>
              <td className="text-xs">{p.asset_class}{p.sector ? ` / ${p.sector}` : ''} / {p.currency}</td>
              <td><Money v={p.value_vnd} /></td><td className="num">{fmtPct(p.eff_own, 1)}</td><td><Money v={p.exposure} /></td>
              <td className="text-xs">{RULE[p.rule]}{p.line_used ? <div className="mono text-fgm">{p.line_used.scope}:{p.line_used.asset_class ?? ''}:{p.line_used.target} mức {p.line_used.level}</div> : null}</td>
              <td className="num">{fmtPct(p.u, 2)}</td><td className="num">{fmtPct(p.asset_shock, 2)}</td>
              <td className="text-xs">{p.fx_line ? `${p.fx_line.target} mức ${p.fx_line.level} × ${fmtPct(p.u_fx, 1)}` : '—'}</td><td className="num">{fmtPct(p.fx_shock, 2)}</td>
              <td><Money v={p.impact} /></td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={10} className="text-right font-medium">Tổng tác động / tài sản ròng</td><td className="num font-medium"><Money v={result.impact} /> <div className="text-fgm">{fmtPct(result.pct, 3)} của <Money v={result.net_worth} short /></div></td></tr></tfoot>
        </table>
      </div>
    </Modal>
  )
}
