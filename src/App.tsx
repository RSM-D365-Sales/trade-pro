import { Route, Routes } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { AnalyticsPage } from './pages/Analytics'
import { CalendarPage } from './pages/Calendar'
import { DashboardPage } from './pages/Dashboard'
import { DeductionsPage } from './pages/Deductions'
import { ForecastPage } from './pages/Forecast'
import { FundsPage } from './pages/Funds'
import { NotFoundPage } from './pages/NotFound'
import { PlanningPage } from './pages/Planning'
import { PromotionsPage } from './pages/Promotions'
import { SalesAnalyticsPage } from './pages/SalesAnalytics'
import { SettingsPage } from './pages/Settings'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/deductions" element={<DeductionsPage />} />
        <Route path="/promotions" element={<PromotionsPage />} />
        <Route path="/promotions/:id" element={<PlanningPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/forecast" element={<ForecastPage />} />
        <Route path="/funds" element={<FundsPage />} />
        <Route path="/sales" element={<SalesAnalyticsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  )
}
