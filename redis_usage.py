#! /usr/bin/python
from argparse import ArgumentParser, ArgumentDefaultsHelpFormatter
import json

BARE_REDIS = 600000
USER_WEIGHT = 300
CALL_WEIGHT = 1400
REVOCATION_WEIGHT = 150
ROOM_WEIGHT = 700
ROOM_PARTICIPANT_WEIGHT = 550


def get_version():
    """Returns the version contained in the package.json file"""
    with open('package.json') as f:
        package = json.load(f)
        return package['version']


def compute_redis_usage(users, daily_calls, monthly_revocations, rooms, rooms_participants):
    """Computes the redis usage, in megabytes"""
    return ((users * USER_WEIGHT +
             daily_calls * users * CALL_WEIGHT +
             monthly_revocations * REVOCATION_WEIGHT +
             rooms * users * ROOM_WEIGHT +
             rooms * users * rooms_participants * ROOM_PARTICIPANT_WEIGHT +
             BARE_REDIS)
            / 1024) / 1024


def main():
    parser = ArgumentParser(
        description="Compute redis usage for loop",
        formatter_class=ArgumentDefaultsHelpFormatter)

    parser.add_argument(
        '-u', '--users',
        dest='users',
        help='The number of users that will be using this server',
        type=int,
        default=1000)

    parser.add_argument(
        '-c', '--calls',
        dest='daily_calls',
        nargs='?',
        help='The number calls that will be done per user (average)',
        type=int,
        default=1)

    parser.add_argument(
        '-m', '--revocations',
        dest='monthly_revocations',
        nargs='?',
        help='The number of revocation, per month',
        type=int,
        default=0)

    parser.add_argument(
        '-r', '--rooms',
        dest='rooms',
        nargs='?',
        help='The number of rooms per user',
        type=int,
        default=5)

    parser.add_argument(
        '-p', '--participants',
        dest='rooms_participants',
        nargs='?',
        help='The average number of rooms participants',
        type=float,
        default=1)

    args = parser.parse_args()

    usage = compute_redis_usage(
        args.users,
        args.daily_calls,
        args.monthly_revocations,
        args.rooms,
        args.rooms_participants
    )

    text = ("""loop-server: v{version}

            The memory usage is {usage} MB for:
             - {users} users
             - with {daily_calls} daily calls per user,
             - {monthly_revocations} call-urls monthly revocations,
             - {rooms} rooms with around {rooms_participants} participants in it at all times\n""")

    print(text.format(**{
        'version': get_version(),
        'users': args.users,
        'daily_calls': args.daily_calls,
        'monthly_revocations': args.monthly_revocations,
        'rooms': args.rooms,
        'rooms_participants': args.rooms_participants,
        'usage': '%.2f' % usage
    }))

if __name__ == '__main__':
    main()
