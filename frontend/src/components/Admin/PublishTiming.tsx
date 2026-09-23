/**
 * Admin feature component: PublishTiming. When cinemas put new screenings
 * online, by weekday and hour, and how long it took us to pick them up — read
 * from the two publish-timing logs the scrape writes. "Cineville" uses
 * Cineville's own creation time per screening (exact, every venue, backfilled
 * from before logging started); "Cinema sites" uses the first time a cinema's
 * own scraper saw a screening, which is only as sharp as that scraper's
 * cadence, so each sighting is spread over the hours since its previous run.
 */
import {
  Box,
  Button,
  Code,
  Heading,
  NativeSelect,
  SimpleGrid,
  Stack,
  Stat,
  Table,
  Text,
} from "@chakra-ui/react"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import {
  AdminService,
  type PublishTimingBucket,
  type PublishTimingResponse,
  type PublishTimingSource,
} from "shared"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const DAY_OPTIONS = [14, 28, 56, 112]
// One sequential hue (blue), mixed into the page surface so an empty hour
// recedes in both light and dark mode rather than reading as a colour.
const HEAT_HUE = "#3987e5"
const BAR_HUE = "#3987e5"

const SOURCE_OPTIONS: { value: PublishTimingSource; label: string }[] = [
  { value: "cineville", label: "Cineville" },
  { value: "sites", label: "Cinema sites" },
]

type Unit = "listings" | "batches"

const pad = (hour: number) => `${hour}`.padStart(2, "0")

const formatMinutes = (minutes: number | null | undefined) => {
  if (minutes === null || minutes === undefined) return "—"
  const sign = minutes < 0 ? "−" : ""
  const absolute = Math.abs(minutes)
  if (absolute < 60) return `${sign}${Math.round(absolute)} min`
  if (absolute < 60 * 48) return `${sign}${(absolute / 60).toFixed(1)} h`
  return `${sign}${(absolute / 60 / 24).toFixed(1)} d`
}

const formatShare = (share: number | null | undefined) =>
  share === null || share === undefined ? "—" : `${Math.round(share * 100)}%`

const formatStamp = (value: string | null) =>
  value ? value.replace("T", " ").slice(0, 16) : "—"

const Heatmap = ({ grid, unit }: { grid: number[][]; unit: Unit }) => {
  const [hovered, setHovered] = useState<[number, number] | null>(null)
  const max = Math.max(1, ...grid.flat())
  const total = grid.flat().reduce((sum, value) => sum + value, 0)
  const rowTotals = grid.map((row) => row.reduce((sum, value) => sum + value, 0))
  const columnTotals = HOURS.map((hour) =>
    grid.reduce((sum, row) => sum + row[hour], 0),
  )
  const readout = hovered
    ? (() => {
        const [day, hour] = hovered
        const value = grid[day][hour]
        const share = total ? (value / total) * 100 : 0
        return `${WEEKDAYS[day]} ${pad(hour)}:00–${pad(hour + 1)}:00 · ${Math.round(value)} ${unit} (${share.toFixed(1)}%)`
      })()
    : `Hover a cell · ${Math.round(total)} ${unit} in total`

  return (
    <Box>
      <Text fontSize="sm" color="fg.muted" mb={2} minH="1.5em">
        {readout}
      </Text>
      <Box overflowX="auto">
        <Box
          display="grid"
          gridTemplateColumns="36px repeat(24, minmax(18px, 1fr)) 56px"
          gap="2px"
          minW="560px"
          onMouseLeave={() => setHovered(null)}
        >
          <Box />
          {HOURS.map((hour) => (
            <Text
              key={hour}
              fontSize="2xs"
              color="fg.muted"
              textAlign="center"
            >
              {hour % 3 === 0 ? pad(hour) : ""}
            </Text>
          ))}
          <Text fontSize="2xs" color="fg.muted" textAlign="right">
            total
          </Text>
          {grid.map((row, day) => (
            <Box key={WEEKDAYS[day]} display="contents">
              <Text fontSize="xs" color="fg.muted" alignSelf="center">
                {WEEKDAYS[day]}
              </Text>
              {row.map((value, hour) => {
                const strength = value > 0 ? 8 + (value / max) * 92 : 0
                const isHovered =
                  hovered?.[0] === day && hovered?.[1] === hour
                return (
                  <Box
                    key={hour}
                    h="22px"
                    borderRadius="2px"
                    bg={`color-mix(in oklab, ${HEAT_HUE} ${strength}%, var(--chakra-colors-bg-muted))`}
                    outline={isHovered ? "2px solid" : undefined}
                    outlineColor="fg"
                    onMouseEnter={() => setHovered([day, hour])}
                    aria-label={`${WEEKDAYS[day]} ${pad(hour)}:00, ${Math.round(value)} ${unit}`}
                  />
                )
              })}
              <Text fontSize="xs" textAlign="right" alignSelf="center">
                {Math.round(rowTotals[day])}
              </Text>
            </Box>
          ))}
          <Text fontSize="2xs" color="fg.muted">
            total
          </Text>
          {columnTotals.map((value, hour) => (
            <Text
              key={HOURS[hour]}
              fontSize="2xs"
              color="fg.muted"
              textAlign="center"
            >
              {value >= 1 ? Math.round(value) : ""}
            </Text>
          ))}
          <Box />
        </Box>
      </Box>
    </Box>
  )
}

const Bars = ({ buckets }: { buckets: PublishTimingBucket[] }) => {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count))
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0)
  return (
    <Stack gap={1}>
      {buckets.map((bucket) => (
        <Box
          key={bucket.label}
          display="grid"
          gridTemplateColumns="80px 1fr 88px"
          alignItems="center"
          gap={2}
          title={`${bucket.label}: ${bucket.count}`}
        >
          <Text fontSize="xs" color="fg.muted">
            {bucket.label}
          </Text>
          <Box h="12px">
            <Box
              h="100%"
              w={`${(bucket.count / max) * 100}%`}
              minW={bucket.count ? "2px" : 0}
              bg={BAR_HUE}
              borderRightRadius="4px"
            />
          </Box>
          <Text fontSize="xs" textAlign="right">
            {bucket.count}{" "}
            <Text as="span" color="fg.muted">
              {total ? `(${Math.round((bucket.count / total) * 100)}%)` : ""}
            </Text>
          </Text>
        </Box>
      ))}
    </Stack>
  )
}

const CinemaTable = ({ data }: { data: PublishTimingResponse }) => {
  const isSites = data.source === "sites"
  return (
    <Box overflowX="auto" maxH="480px" overflowY="auto">
      <Table.Root size="sm" stickyHeader>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{isSites ? "Cinema" : "Venue"}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Screenings</Table.ColumnHeader>
            <Table.ColumnHeader>Busiest day</Table.ColumnHeader>
            <Table.ColumnHeader>Busiest hour</Table.ColumnHeader>
            {isSites ? (
              <>
                <Table.ColumnHeader textAlign="end">
                  Also on Cineville
                </Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">
                  Site first
                </Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">
                  Site ahead by (median)
                </Table.ColumnHeader>
              </>
            ) : (
              <Table.ColumnHeader textAlign="end">
                Our delay (median)
              </Table.ColumnHeader>
            )}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {data.per_cinema.map((row) => (
            <Table.Row key={`${row.cinema_id ?? "venue"}-${row.name}`}>
              <Table.Cell>
                {row.name}
                {row.cinema_id === null && (
                  <Text as="span" color="fg.muted">
                    {" "}
                    (not in MiKiNO)
                  </Text>
                )}
              </Table.Cell>
              <Table.Cell textAlign="end">{row.listings}</Table.Cell>
              <Table.Cell>
                {row.top_weekday === null
                  ? "—"
                  : `${WEEKDAYS[row.top_weekday]} (${formatShare(row.top_weekday_share)})`}
              </Table.Cell>
              <Table.Cell>
                {row.top_hour === null ? "—" : `${pad(row.top_hour)}:00`}
              </Table.Cell>
              {isSites ? (
                <>
                  <Table.Cell textAlign="end">
                    {row.both_sources_count ?? "—"}
                  </Table.Cell>
                  <Table.Cell textAlign="end">
                    {formatShare(row.site_first_share)}
                  </Table.Cell>
                  <Table.Cell textAlign="end">
                    {formatMinutes(row.median_site_lead_minutes)}
                  </Table.Cell>
                </>
              ) : (
                <Table.Cell textAlign="end">
                  {formatMinutes(row.median_delay_minutes)}
                </Table.Cell>
              )}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  )
}

const RecentTable = ({ data }: { data: PublishTimingResponse }) => (
  <Box overflowX="auto">
    <Table.Root size="sm">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>
            {data.source === "sites" ? "First seen" : "Published"}
          </Table.ColumnHeader>
          <Table.ColumnHeader>Cinema</Table.ColumnHeader>
          <Table.ColumnHeader>Film</Table.ColumnHeader>
          <Table.ColumnHeader>Screening</Table.ColumnHeader>
          {data.source === "cineville" && (
            <Table.ColumnHeader textAlign="end">We had it after</Table.ColumnHeader>
          )}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {data.recent.map((listing) => (
          <Table.Row
            key={`${listing.cinema_name}-${listing.screening_at}-${listing.published_at}-${listing.title}`}
          >
            <Table.Cell whiteSpace="nowrap">
              {formatStamp(listing.published_at)}
            </Table.Cell>
            <Table.Cell>{listing.cinema_name}</Table.Cell>
            <Table.Cell>{listing.title ?? "—"}</Table.Cell>
            <Table.Cell whiteSpace="nowrap">
              {formatStamp(listing.screening_at)}
            </Table.Cell>
            {data.source === "cineville" && (
              <Table.Cell textAlign="end">
                {listing.first_seen_at
                  ? formatMinutes(listing.delay_minutes)
                  : "not seen live"}
              </Table.Cell>
            )}
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  </Box>
)

const PublishTiming = () => {
  const [source, setSource] = useState<PublishTimingSource>("cineville")
  const [days, setDays] = useState(56)
  const [cinemaId, setCinemaId] = useState<number | null>(null)
  const [unit, setUnit] = useState<Unit>("listings")

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "publish-timing", source, days, cinemaId],
    queryFn: () => AdminService.getPublishTiming({ source, days, cinemaId }),
  })

  const cinemaOptions = (data?.cinemas ?? []).filter((cinema) =>
    source === "sites" ? cinema.own_scraper : cinema.cineville,
  )

  return (
    <Box mb={10}>
      <Heading size="md" mb={1}>
        When cinemas publish
      </Heading>
      <Text color="fg.muted" fontSize="sm" mb={3}>
        {source === "cineville"
          ? "Cineville's own creation time for every screening it lists (hidden ones and ones not yet tied to a film excluded). Exact to the minute, and back-filled from before logging began."
          : `The first scrape of each cinema's own site that listed a screening. It went up somewhere since that scraper's previous run${
              data?.median_window_minutes
                ? ` (typically ${formatMinutes(data.median_window_minutes)} earlier)`
                : ""
            }, so each one is spread over those hours.`}{" "}
        JSON: <Code>/api/v1/admin/scrape/publish-timing?source={source}</Code>
      </Text>

      <Stack direction="row" gap={2} mb={4} wrap="wrap" align="center">
        {SOURCE_OPTIONS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={source === option.value ? "solid" : "outline"}
            onClick={() => {
              setSource(option.value)
              setCinemaId(null)
            }}
          >
            {option.label}
          </Button>
        ))}
        <Box w="1px" h="24px" bg="border" mx={1} />
        {DAY_OPTIONS.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={days === option ? "solid" : "outline"}
            onClick={() => setDays(option)}
          >
            {option}d
          </Button>
        ))}
        <Box w="1px" h="24px" bg="border" mx={1} />
        <NativeSelect.Root size="sm" width="220px">
          <NativeSelect.Field
            value={cinemaId ?? ""}
            onChange={(event) =>
              setCinemaId(event.target.value ? Number(event.target.value) : null)
            }
          >
            <option value="">
              {source === "cineville" ? "All Cineville venues" : "All cinemas"}
            </option>
            {cinemaOptions.map((cinema) => (
              <option key={cinema.cinema_id} value={cinema.cinema_id}>
                {cinema.name}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Stack>

      {isLoading || !data ? (
        <Text>Loading publish timing…</Text>
      ) : (
        <>
          <SimpleGrid columns={{ base: 2, md: 4 }} gap={4} mb={6}>
            <Stat.Root>
              <Stat.Label>Screenings published</Stat.Label>
              <Stat.ValueText>{data.listings}</Stat.ValueText>
            </Stat.Root>
            <Stat.Root>
              <Stat.Label>Publish moments</Stat.Label>
              <Stat.ValueText>{data.batches}</Stat.ValueText>
            </Stat.Root>
            <Stat.Root>
              <Stat.Label>
                {data.delay ? "Our delay, median" : "Scrape window, median"}
              </Stat.Label>
              <Stat.ValueText>
                {formatMinutes(
                  data.delay
                    ? data.delay.median_minutes
                    : data.median_window_minutes,
                )}
              </Stat.ValueText>
            </Stat.Root>
            <Stat.Root>
              <Stat.Label>
                {data.delay ? "Our delay, 90th percentile" : "Logging since"}
              </Stat.Label>
              <Stat.ValueText>
                {data.delay
                  ? formatMinutes(data.delay.p90_minutes)
                  : formatStamp(data.logging_started_at).slice(0, 10)}
              </Stat.ValueText>
            </Stat.Root>
          </SimpleGrid>

          <Stack direction="row" gap={2} mb={2} align="center">
            <Text fontWeight="semibold" fontSize="sm">
              Weekday × hour (Amsterdam), counting
            </Text>
            <Button
              size="xs"
              variant={unit === "listings" ? "solid" : "outline"}
              onClick={() => setUnit("listings")}
            >
              screenings
            </Button>
            <Button
              size="xs"
              variant={unit === "batches" ? "solid" : "outline"}
              onClick={() => setUnit("batches")}
            >
              publish moments
            </Button>
          </Stack>
          <Text fontSize="xs" color="fg.muted" mb={2}>
            A cinema putting 40 screenings online at once is 40 screenings but
            one publish moment.
          </Text>
          <Box mb={6}>
            <Heatmap
              grid={
                unit === "listings" ? data.heatmap_listings : data.heatmap_batches
              }
              unit={unit === "listings" ? "screenings" : "publish moments"}
            />
          </Box>

          <SimpleGrid columns={{ base: 1, md: 2 }} gap={8} mb={6}>
            <Box>
              <Text fontWeight="semibold" fontSize="sm" mb={2}>
                Published how long before the screening
              </Text>
              <Bars buckets={data.lead_time} />
            </Box>
            {data.delay && (
              <Box>
                <Text fontWeight="semibold" fontSize="sm" mb={1}>
                  How long until we had it
                </Text>
                <Text fontSize="xs" color="fg.muted" mb={2}>
                  {data.delay.count
                    ? `${data.delay.count} screenings published since logging began (${formatStamp(data.logging_started_at)})`
                    : "Nothing published since logging began yet."}
                </Text>
                <Bars buckets={data.delay.buckets} />
              </Box>
            )}
          </SimpleGrid>

          <Text fontWeight="semibold" fontSize="sm" mb={2}>
            Per {data.source === "sites" ? "cinema" : "venue"}
          </Text>
          <Box mb={6}>
            <CinemaTable data={data} />
          </Box>

          <Text fontWeight="semibold" fontSize="sm" mb={2}>
            Latest additions
          </Text>
          <RecentTable data={data} />
        </>
      )}
    </Box>
  )
}

export default PublishTiming
