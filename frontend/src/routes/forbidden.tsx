import { createFileRoute } from '@tanstack/react-router'
import Forbidden from '@/components/Common/Forbidden'

export const Route = createFileRoute('/forbidden')({
  component: Forbidden,
})
