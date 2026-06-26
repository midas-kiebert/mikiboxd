/**
 * TanStack Router route module for admin/showtimes. It connects URL state to the matching page component.
 */
import { Container } from "@chakra-ui/react"
import { createFileRoute } from "@tanstack/react-router"

import AdminGuard from "@/components/Admin/AdminGuard"
import AdminShowtimes from "@/components/Admin/AdminShowtimes"
import Page from "@/components/Common/Page"

export const Route = createFileRoute("/_layout/admin/showtimes")({
  component: AdminShowtimesPage,
})

function AdminShowtimesPage() {
  return (
    <AdminGuard>
      <Page>
        <Container maxW="full">
          <AdminShowtimes />
        </Container>
      </Page>
    </AdminGuard>
  )
}
