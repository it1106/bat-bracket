import { levelTable, AGE_GROUPS, POINTS_ROUNDS, ROUND_LABELS } from '@/lib/points/bat-points'

const LEVELS = [1, 2, 3, 4, 5, 6]

export default function PointsTableReference() {
  return (
    <div className="pts-ref">
      {LEVELS.map((lv) => {
        const grid = levelTable(lv)
        return (
          <div className="pts-ref-block" key={lv}>
            <h3 className="pts-ref-title">Lv{lv}</h3>
            <div className="pts-ref-scroll">
              <table className="pts-ref-table">
                <thead>
                  <tr>
                    <th>Rounds</th>
                    {AGE_GROUPS.map((age) => (
                      <th key={age}>{age}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {POINTS_ROUNDS.map((round, i) => (
                    <tr key={round}>
                      <th scope="row">{ROUND_LABELS[round]}</th>
                      {AGE_GROUPS.map((age) => (
                        <td key={age}>{grid[age][i].toLocaleString('en-US')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
