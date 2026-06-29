/**
 * Admin feature component: AdminOverview. Beta usage-analytics dashboard.
 */
import {
  Box,
  Button,
  Heading,
  SimpleGrid,
  Stack,
  Stat,
  Table,
  Text,
} from "@chakra-ui/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { AdminService } from "shared"

const AdminNav = () => (
  <Stack direction="row" gap={2} mb={6}>
    <Button asChild size="sm" variant="outline">
      <Link to="/admin/movies">Movies</Link>
    </Button>
    <Button asChild size="sm" variant="outline">
      <Link to="/admin/showtimes">Showtimes</Link>
    </Button>
    <Button asChild size="sm" variant="outline">
      <Link to="/admin/reports">Reports</Link>
    </Button>
  </Stack>
)

const AdminOverview = () => {
  const { data: overview, isLoading } = useQuery({
    queryKey: ["admin", "analytics-overview"],
    queryFn: () => AdminService.getAnalyticsOverview({ windowDays: 30 }),
  })

  if (isLoading || !overview) {
    return (
      <Box>
        <AdminNav />
        <Text>Loading analytics…</Text>
      </Box>
    )
  }

  const inviteOpenRate = overview.invites_sent
    ? Math.round((overview.invites_opened / overview.invites_sent) * 100)
    : 0
  const notificationCtr = overview.notifications_sent
    ? Math.round(
        (overview.notifications_clicked / overview.notifications_sent) * 100,
      )
    : 0

  return (
    <Box>
      <AdminNav />
      <Heading size="md" mb={4}>
        Last {overview.window_days} days
      </Heading>

      <SimpleGrid columns={{ base: 2, md: 4 }} gap={4} mb={8}>
        <Stat.Root>
          <Stat.Label>Total users</Stat.Label>
          <Stat.ValueText>{overview.total_users}</Stat.ValueText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>Users with push enabled</Stat.Label>
          <Stat.ValueText>{overview.users_with_push_token}</Stat.ValueText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>Invites sent / opened</Stat.Label>
          <Stat.ValueText>
            {overview.invites_sent} / {overview.invites_opened} (
            {inviteOpenRate}%)
          </Stat.ValueText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>Notification click-through</Stat.Label>
          <Stat.ValueText>
            {overview.notifications_clicked} / {overview.notifications_sent} (
            {notificationCtr}%)
          </Stat.ValueText>
        </Stat.Root>
      </SimpleGrid>

      <Heading size="sm" mb={2}>
        Feature usage
      </Heading>
      <Table.Root size="sm" mb={8}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Event</Table.ColumnHeader>
            <Table.ColumnHeader>Count</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {Object.entries(overview.event_counts).map(([name, count]) => (
            <Table.Row key={name}>
              <Table.Cell>{name}</Table.Cell>
              <Table.Cell>{count}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>

      <Heading size="sm" mb={2}>
        Opens by day / user
      </Heading>
      <Table.Root size="sm" mb={8}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Day</Table.ColumnHeader>
            <Table.ColumnHeader>User</Table.ColumnHeader>
            <Table.ColumnHeader>Platform</Table.ColumnHeader>
            <Table.ColumnHeader>Count</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {overview.opens_by_day_user.map((row, i) => (
            <Table.Row key={i}>
              <Table.Cell>{row.day}</Table.Cell>
              <Table.Cell>{row.user_email}</Table.Cell>
              <Table.Cell>{row.platform ?? "unknown"}</Table.Cell>
              <Table.Cell>{row.count}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>

      <Heading size="sm" mb={2}>
        Notification opt-in rates
      </Heading>
      <Table.Root size="sm">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Setting</Table.ColumnHeader>
            <Table.ColumnHeader>Enabled</Table.ColumnHeader>
            <Table.ColumnHeader>Disabled</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {overview.notification_opt_in.map((row) => (
            <Table.Row key={row.setting}>
              <Table.Cell>{row.setting}</Table.Cell>
              <Table.Cell>{row.enabled_count}</Table.Cell>
              <Table.Cell>{row.disabled_count}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  )
}

export default AdminOverview
