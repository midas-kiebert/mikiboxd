// This file is auto-generated by @hey-api/openapi-ts

export type Body_login_login_access_token = {
  grant_type?: string | null
  username: string
  password: string
  scope?: string
  client_id?: string | null
  client_secret?: string | null
}

export type CinemaPublic = {
  /**
   * Name of the cinema
   */
  name: string
  cineville: boolean
  badge_bg_color: string
  badge_text_color: string
  url: string
  id: number
  city: CityPublic
}

export type CityPublic = {
  /**
   * Name of the city
   */
  name: string
  /**
   * ID of the city
   */
  id: number
}

export type HTTPValidationError = {
  detail?: Array<ValidationError>
}

export type Message = {
  message: string
}

export type MovieLoggedIn = {
  id: number
  title: string
  poster_link?: string | null
  letterboxd_slug?: string | null
  showtimes: Array<ShowtimeInMovieLoggedIn>
}

export type MovieSummaryLoggedIn = {
  id: number
  title: string
  poster_link?: string | null
  letterboxd_slug?: string | null
  showtimes: Array<ShowtimeInMovieLoggedIn>
  cinemas: Array<CinemaPublic>
  last_showtime_datetime: string | null
  total_showtimes: number
  friends_going: Array<UserPublic>
  going: boolean
}

export type NewPassword = {
  token: string
  new_password: string
}

export type ShowtimeInMovieLoggedIn = {
  datetime: string
  theatre?: string
  ticket_link?: string | null
  id: number
  cinema: CinemaPublic
  friends_going: Array<UserPublic>
  going: boolean
}

export type ShowtimeLoggedIn = {
  datetime: string
  theatre?: string
  ticket_link?: string | null
  id: number
  movie: MovieSummaryLoggedIn
  cinema: CinemaPublic
  friends_going: Array<UserPublic>
  going: boolean
}

export type Token = {
  access_token: string
  /**
   * Type of the token, usually 'bearer'
   */
  token_type?: string
}

export type UpdatePassword = {
  current_password: string
  new_password: string
}

export type UserPublic = {
  email: string
  is_active?: boolean
  is_superuser?: boolean
  display_name?: string | null
  letterboxd_username?: string | null
  id: string
  last_watchlist_sync: string | null
}

export type UserRegister = {
  email: string
  password: string
  display_name?: string | null
}

export type UserUpdateMe = {
  display_name?: string | null
  email?: string | null
  letterboxd_username?: string | null
}

export type UserWithFriendStatus = {
  email: string
  is_active?: boolean
  is_superuser?: boolean
  display_name?: string | null
  letterboxd_username?: string | null
  id: string
  last_watchlist_sync: string | null
  is_friend: boolean
  sent_request: boolean
  received_request: boolean
}

export type ValidationError = {
  loc: Array<string | number>
  msg: string
  type: string
}

export type FriendsSendFriendRequestData = {
  receiverId: string
}

export type FriendsSendFriendRequestResponse = Message

export type FriendsAcceptFriendRequestData = {
  senderId: string
}

export type FriendsAcceptFriendRequestResponse = Message

export type FriendsDeclineFriendRequestData = {
  senderId: string
}

export type FriendsDeclineFriendRequestResponse = Message

export type FriendsCancelFriendRequestData = {
  receiverId: string
}

export type FriendsCancelFriendRequestResponse = Message

export type FriendsRemoveFriendData = {
  friendId: string
}

export type FriendsRemoveFriendResponse = Message

export type LoginLoginAccessTokenData = {
  formData: Body_login_login_access_token
}

export type LoginLoginAccessTokenResponse = Token

export type LoginTestTokenResponse = UserPublic

export type LoginRecoverPasswordData = {
  email: string
}

export type LoginRecoverPasswordResponse = Message

export type LoginResetPasswordData = {
  requestBody: NewPassword
}

export type LoginResetPasswordResponse = Message

export type LoginRecoverPasswordHtmlContentData = {
  email: string
}

export type LoginRecoverPasswordHtmlContentResponse = string

export type MeGetCurrentUserResponse = UserPublic

export type MeDeleteUserMeResponse = Message

export type MeUpdateUserMeData = {
  requestBody: UserUpdateMe
}

export type MeUpdateUserMeResponse = UserPublic

export type MeUpdatePasswordMeData = {
  requestBody: UpdatePassword
}

export type MeUpdatePasswordMeResponse = Message

export type MeGetMyShowtimesData = {
  limit?: number
  offset?: number
  snapshotTime?: string
}

export type MeGetMyShowtimesResponse = Array<ShowtimeLoggedIn>

export type MeSyncWatchlistResponse = Message

export type MeGetFriendsResponse = Array<UserPublic>

export type MeGetSentFriendRequestsResponse = Array<UserPublic>

export type MeGetReceivedFriendRequestsResponse = Array<UserPublic>

export type MoviesReadMoviesData = {
  limit?: number
  offset?: number
  query?: string
  showtimeLimit?: number
  snapshotTime?: string
  watchlistOnly?: boolean
}

export type MoviesReadMoviesResponse = Array<MovieSummaryLoggedIn>

export type MoviesReadMovieData = {
  id: number
  snapshotTime?: string
}

export type MoviesReadMovieResponse = MovieLoggedIn

export type ShowtimesSelectShowtimeData = {
  showtimeId: number
}

export type ShowtimesSelectShowtimeResponse = ShowtimeLoggedIn

export type ShowtimesDeleteShowtimeSelectionData = {
  showtimeId: number
}

export type ShowtimesDeleteShowtimeSelectionResponse = ShowtimeLoggedIn

export type ShowtimesToggleShowtimeSelectionData = {
  showtimeId: number
}

export type ShowtimesToggleShowtimeSelectionResponse = ShowtimeLoggedIn

export type UsersSearchUsersData = {
  limit?: number
  offset?: number
  query: string
}

export type UsersSearchUsersResponse = Array<UserWithFriendStatus>

export type UsersRegisterUserData = {
  requestBody: UserRegister
}

export type UsersRegisterUserResponse = UserPublic

export type UsersGetUserData = {
  userId: string
}

export type UsersGetUserResponse = UserPublic

export type UsersGetUserSelectedShowtimesData = {
  limit?: number
  offset?: number
  snapshotTime?: string
  userId: string
}

export type UsersGetUserSelectedShowtimesResponse = Array<ShowtimeLoggedIn>

export type UtilsTestEmailData = {
  emailTo: string
}

export type UtilsTestEmailResponse = Message

export type UtilsHealthCheckResponse = boolean
