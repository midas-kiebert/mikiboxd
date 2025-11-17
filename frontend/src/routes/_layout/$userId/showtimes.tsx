import { createFileRoute } from '@tanstack/react-router'
import ShowtimesPage from '@/components/Showtimes/ShowtimesPage'
import { UUID } from 'crypto'

//@ts-ignore
export const Route = createFileRoute('/_layout/$userId/showtimes')({
  component: () => {
    const params = Route.useParams()
    const { userId } = params as { userId: UUID }

    return <ShowtimesPage userId={userId}/>
  }
})
