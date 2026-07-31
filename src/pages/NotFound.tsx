import { Compass } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { PageBody } from '../components/PageHeader'
import { Button, Card, EmptyState } from '../components/ui'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <PageBody>
      <Card>
        <EmptyState
          icon={Compass}
          title="That page doesn’t exist"
          hint="The link may be stale, or the record it pointed at was removed. Press Cmd-K to search for a promotion, deduction or customer."
          action={<Button variant="primary" onClick={() => navigate('/')}>Back to dashboard</Button>}
        />
      </Card>
    </PageBody>
  )
}
