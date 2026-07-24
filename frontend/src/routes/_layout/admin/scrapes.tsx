/**
 * TanStack Router route module for the admin scrape monitor. It connects URL
 * state to the matching page component.
 */
import { Container } from "@chakra-ui/react"
import { createFileRoute } from "@tanstack/react-router"

import AdminGuard from "@/components/Admin/AdminGuard"
import ScrapeMonitor from "@/components/Admin/ScrapeMonitor"
import Page from "@/components/Common/Page"

export const Route = createFileRoute("/_layout/admin/scrapes")({
  component: ScrapeMonitorPage,
})

function ScrapeMonitorPage() {
  return (
    <AdminGuard>
      <Page>
        <Container maxW="full">
          <ScrapeMonitor />
        </Container>
      </Page>
    </AdminGuard>
  )
}
