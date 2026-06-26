/**
 * TanStack Router route module for admin/reports. It connects URL state to the matching page component.
 */
import { Container } from "@chakra-ui/react"
import { createFileRoute } from "@tanstack/react-router"

import AdminGuard from "@/components/Admin/AdminGuard"
import AdminReports from "@/components/Admin/AdminReports"
import Page from "@/components/Common/Page"

export const Route = createFileRoute("/_layout/admin/reports")({
  component: AdminReportsPage,
})

function AdminReportsPage() {
  return (
    <AdminGuard>
      <Page>
        <Container maxW="full">
          <AdminReports />
        </Container>
      </Page>
    </AdminGuard>
  )
}
