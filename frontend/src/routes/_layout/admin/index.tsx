/**
 * TanStack Router route module for admin (analytics overview). It connects URL state to the matching page component.
 */
import { Container } from "@chakra-ui/react"
import { createFileRoute } from "@tanstack/react-router"

import AdminGuard from "@/components/Admin/AdminGuard"
import AdminOverview from "@/components/Admin/AdminOverview"
import Page from "@/components/Common/Page"

export const Route = createFileRoute("/_layout/admin/")({
  component: AdminOverviewPage,
})

function AdminOverviewPage() {
  return (
    <AdminGuard>
      <Page>
        <Container maxW="full">
          <AdminOverview />
        </Container>
      </Page>
    </AdminGuard>
  )
}
