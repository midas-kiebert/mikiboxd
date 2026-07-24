/**
 * TanStack Router route module for admin/movies. It connects URL state to the matching page component.
 */
import { Container } from "@chakra-ui/react"
import { createFileRoute } from "@tanstack/react-router"

import AdminGuard from "@/components/Admin/AdminGuard"
import AdminMovies from "@/components/Admin/AdminMovies"
import Page from "@/components/Common/Page"

export const Route = createFileRoute("/_layout/admin/movies")({
  component: AdminMoviesPage,
})

function AdminMoviesPage() {
  return (
    <AdminGuard>
      <Page>
        <Container maxW="full">
          <AdminMovies />
        </Container>
      </Page>
    </AdminGuard>
  )
}
