/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import PointsTableReference from '@/components/PointsTableReference'

describe('PointsTableReference', () => {
  it('renders all six level tables', () => {
    render(<PointsTableReference />)
    for (const lv of ['Lv1', 'Lv2', 'Lv3', 'Lv4', 'Lv5', 'Lv6']) {
      expect(screen.getByText(lv)).toBeInTheDocument()
    }
  })

  it('shows the known Lv1 Open Winner value', () => {
    render(<PointsTableReference />)
    expect(screen.getAllByText('40,000').length).toBeGreaterThan(0)
  })
})
