import chai, { assert, expect } from "chai"
import chaiAsPromised from "chai-as-promised"
import { getAuth, signInWithEmailAndPassword } from "firebase/auth"
import fetch from "@adobe/node-fetch-retry"
// import { randomBytes } from "crypto"
import fs from "fs"
import {
    getOpenedCeremonies,
    getCeremonyCircuits,
    getNextCircuitForContribution,
    checkParticipantForCeremony,
    resumeContributionAfterTimeoutExpiration,
    formatZkeyIndex,
    getBucketName,
    getZkeyStorageFilePath,
    generateGetObjectPreSignedUrl,
    createS3Bucket,
    multiPartUpload,
    genesisZkeyIndex
} from "../../src"
import { fakeCeremoniesData, fakeCircuitsData, fakeUsersData } from "../data/samples"
import {
    initializeAdminServices,
    initializeUserServices,
    generatePseudoRandomStringOfNumbers,
    deleteAdminApp,
    createMockCeremony,
    cleanUpMockCeremony,
    cleanUpMockUsers,
    storeMockParticipant,
    cleanUpMockParticipant,
    createMockTimedOutContribution,
    cleanUpMockTimeout,
    createMockUser,
    getStorageConfiguration,
    getContributionLocalFilePath
} from "../utils"
import { generateFakeParticipant } from "../data/generators"
import { ParticipantContributionStep, ParticipantStatus } from "../../src/types/enums"

// Config chai.
chai.use(chaiAsPromised)

describe("Contribution", () => {
    // Initialize admin and user services.
    const { adminFirestore, adminAuth } = initializeAdminServices()
    const { userApp, userFirestore, userFunctions } = initializeUserServices()
    const userAuth = getAuth(userApp)

    const users = [fakeUsersData.fakeUser1, fakeUsersData.fakeUser2]
    const passwords = [generatePseudoRandomStringOfNumbers(24), generatePseudoRandomStringOfNumbers(24)]

    const { ceremonyBucketPostfix, presignedUrlExpirationInSeconds, streamChunkSizeInMb } = getStorageConfiguration()

    const fileToUploadPath = "/tmp/file.json"
    fs.writeFileSync(fileToUploadPath, JSON.stringify({ test: "test" }))

    beforeAll(async () => {
        // Create users
        for (let i = 0; i < 2; i++) {
            users[i].uid = await createMockUser(
                userApp,
                users[i].data.email,
                passwords[i],
                i === passwords.length - 1, // last one is coordinator
                adminAuth
            )
        }

        // Create the mock data on Firestore (ceremony)
        await createMockCeremony(
            adminFirestore,
            fakeCeremoniesData.fakeCeremonyOpenedFixed,
            fakeCircuitsData.fakeCircuitSmallNoContributors
        )
        console.log(fakeCeremoniesData.fakeCeremonyOpenedFixed.uid)
    })

    it("should return all open ceremonies to a logged in user wanting to contribute", async () => {
        // login as user 0
        await signInWithEmailAndPassword(userAuth, users[0].data.email, passwords[0])
        const openedCeremonies = await getOpenedCeremonies(userFirestore)
        expect(openedCeremonies.length).to.be.gt(0)
    })
    it("should return all circuits for a particular ceremony to a logged in user wanting to contribute", async () => {
        const openedCeremonies = await getOpenedCeremonies(userFirestore)
        const circuits = await getCeremonyCircuits(userFirestore, openedCeremonies.at(0)?.id!)
        expect(circuits.length).to.be.gt(0)
    })
    it("should return an empty array when a logged in user tries to get the available circuits for a non existent ceremony", async () => {
        expect((await getCeremonyCircuits(userFirestore, "88")).length).to.be.eq(0)
    })
    it("should return the next circuit ready for contribution to a logged in contributor looking to contribute to a particular ceremony", async () => {
        // login as user 0
        await signInWithEmailAndPassword(userAuth, users[0].data.email, passwords[0])
        const openedCeremonies = await getOpenedCeremonies(userFirestore)
        const circuits = await getCeremonyCircuits(userFirestore, openedCeremonies.at(0)?.id!)
        expect(circuits.length).to.be.gt(0)
        const nextForContribution = getNextCircuitForContribution(circuits, 1)
        expect(nextForContribution).not.be.null
    })
    it("should revert when a user tries to register as a contributor to a non existent ceremony", async () => {
        // login as user 0
        await signInWithEmailAndPassword(userAuth, users[0].data.email, passwords[0])
        expect(checkParticipantForCeremony(userFunctions, "88")).to.be.rejectedWith("INTERNAL")
    })
    it("should block a contributor that is idle when contributing", async () => {
        // create locked out participant
        await createMockTimedOutContribution(
            adminFirestore,
            users[1].uid,
            fakeCeremoniesData.fakeCeremonyOpenedFixed.uid
        )
        const ceremonyId = fakeCeremoniesData.fakeCeremonyOpenedFixed.uid
        // use user 2
        await signInWithEmailAndPassword(userAuth, users[1].data.email, passwords[1])
        const result = await checkParticipantForCeremony(userFunctions, ceremonyId)
        expect(result).to.be.false

        await cleanUpMockTimeout(adminFirestore, ceremonyId, users[1].uid)
    })
    it.skip("should allow a participant to resume a contribution after their locked status is removed", async () => {
        // mock timeout
        const participantContributing = generateFakeParticipant({
            uid: users[0].uid,
            data: {
                userId: users[0].uid,
                contributionProgress: 1,
                contributionStep: ParticipantContributionStep.COMPUTING,
                status: ParticipantStatus.EXHUMED,
                contributions: [],
                lastUpdated: Date.now(),
                contributionStartedAt: Date.now() - 100,
                verificationStartedAt: Date.now(),
                tempContributionData: {
                    contributionComputationTime: Date.now() - 100,
                    uploadId: "001",
                    chunks: []
                }
            }
        })

        await signInWithEmailAndPassword(userAuth, users[0].data.email, passwords[0])

        await storeMockParticipant(
            adminFirestore,
            fakeCeremoniesData.fakeCeremonyOpenedFixed.uid,
            users[0].uid,
            participantContributing
        )

        assert.isFulfilled(
            resumeContributionAfterTimeoutExpiration(userFunctions, fakeCeremoniesData.fakeCeremonyOpenedFixed.uid)
        )

        // clean up
        await cleanUpMockParticipant(adminFirestore, fakeCeremoniesData.fakeCeremonyOpenedFixed.uid, users[0].uid)
    })
    it("should fail to resume a contribution on a ceremony where the user is not timed out", async () => {
        // mock timeout
        const participantContributing = generateFakeParticipant({
            uid: users[0].uid,
            data: {
                userId: users[0].uid,
                contributionProgress: 1,
                contributionStep: ParticipantContributionStep.COMPUTING,
                status: ParticipantStatus.WAITING,
                contributions: [],
                lastUpdated: Date.now(),
                contributionStartedAt: Date.now() - 100,
                verificationStartedAt: Date.now(),
                tempContributionData: {
                    contributionComputationTime: Date.now() - 100,
                    uploadId: "001",
                    chunks: []
                }
            }
        })

        await signInWithEmailAndPassword(userAuth, users[0].data.email, passwords[0])

        await storeMockParticipant(
            adminFirestore,
            fakeCeremoniesData.fakeCeremonyOpenedFixed.uid,
            users[0].uid,
            participantContributing
        )

        assert.isRejected(
            resumeContributionAfterTimeoutExpiration(userFunctions, fakeCeremoniesData.fakeCeremonyOpenedFixed.uid)
        )

        // clean up
        await cleanUpMockParticipant(adminFirestore, fakeCeremoniesData.fakeCeremonyOpenedFixed.uid, users[0].uid)
    })
    it("should get the contributor's attestation after successfully contributing to a ceremony", async () => {})
    it("should continue to contribute to the next circuit with makeProgressToNextContribution cloud function", async () => {})
    it.skip("should allow an authenticated user to contribute to a ceremony", async () => {
        // pre condition 1. setup ceremony (done in beforeAll)
        // create a bucket and upload data
        // sign in as coordinator
        await signInWithEmailAndPassword(userAuth, users[1].data.email, passwords[1])
        const ceremony = fakeCeremoniesData.fakeCeremonyOpenedFixed
        const tmpCircuit = fakeCircuitsData.fakeCircuitSmallNoContributors
        const ceremonyId = ceremony.uid
        const bucketName = getBucketName(ceremony.data.prefix, ceremonyBucketPostfix)
        await createS3Bucket(userFunctions, bucketName)

        let storagePath = getZkeyStorageFilePath(
            tmpCircuit.data.prefix!,
            `${tmpCircuit.data.prefix}_${genesisZkeyIndex}.zkey`
        )

        const success = await multiPartUpload(
            userFunctions,
            bucketName,
            storagePath,
            fileToUploadPath,
            streamChunkSizeInMb.toString(),
            presignedUrlExpirationInSeconds
        )
        expect(success).to.be.true

        // 1. login as user 0
        await signInWithEmailAndPassword(userAuth, users[0].data.email, passwords[0])

        // 2. get circuits for ceremony
        const circuits = await getCeremonyCircuits(userFirestore, ceremonyId)
        expect(circuits.length).to.be.gt(0)

        // 3. register for cermeony
        const canParticipate = await checkParticipantForCeremony(userFunctions, ceremonyId)
        expect(canParticipate).to.be.true

        // 4. entropy
        // const entropy = randomBytes(32).toString("hex")

        // 5. get circuit to contribute to
        const circuit = getNextCircuitForContribution(circuits, 1)
        expect(circuit).not.be.null

        // 6. get circuit data
        const currentProgress = circuit.data.waitingQueue.completedContributions
        const currentZkeyIndex = formatZkeyIndex(currentProgress)
        // const nextZkeyIndex = formatZkeyIndex(currentProgress + 1)

        // 7. download previous contribution
        storagePath = getZkeyStorageFilePath(circuit.data.prefix, `${circuit.data.prefix}_${currentZkeyIndex}.zkey`)

        const localPath = getContributionLocalFilePath(`${circuit.data.prefix}_${currentZkeyIndex}.zkey`)

        // Call generateGetObjectPreSignedUrl() Cloud Function.
        const preSignedUrl = await generateGetObjectPreSignedUrl(userFunctions, bucketName, storagePath)
        const getResponse = await fetch(preSignedUrl)

        // Write the file to disk.
        fs.writeFileSync(localPath, await getResponse.buffer())

        // // 9. progress to next step
        // await progressToNextContributionStep(userFunctions, ceremonyId)

        // 10. do contribution

        // 11. store it on disk
    })

    afterAll(async () => {
        // Clean ceremony and user from DB.
        await cleanUpMockTimeout(adminFirestore, users[1].uid, fakeCeremoniesData.fakeCeremonyOpenedFixed.uid)
        await cleanUpMockCeremony(
            adminFirestore,
            fakeCeremoniesData.fakeCeremonyOpenedFixed.uid,
            fakeCircuitsData.fakeCircuitSmallNoContributors.uid
        )
        await cleanUpMockUsers(adminAuth, adminFirestore, users)
        // Delete admin app.
        await deleteAdminApp()

        // remove file
        fs.unlinkSync(fileToUploadPath)

        // clean up S3 bucket
    })
})
