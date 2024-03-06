import dotenv from "dotenv"
import * as functions from "firebase-functions"
import { ApiSdk } from "@bandada/api-sdk"
import { groth16 } from "snarkjs"
import { getAuth } from "firebase-admin/auth"
import admin from "firebase-admin"
import { BandadaValidateProof, VerifiedBandadaResponse } from "../types/index"

const VKEY_DATA = {
    protocol: "groth16",
    curve: "bn128",
    nPublic: 3,
    vk_alpha_1: [
        "20491192805390485299153009773594534940189261866228447918068658471970481763042",
        "9383485363053290200918347156157836566562967994039712273449902621266178545958",
        "1"
    ],
    vk_beta_2: [
        [
            "6375614351688725206403948262868962793625744043794305715222011528459656738731",
            "4252822878758300859123897981450591353533073413197771768651442665752259397132"
        ],
        [
            "10505242626370262277552901082094356697409835680220590971873171140371331206856",
            "21847035105528745403288232691147584728191162732299865338377159692350059136679"
        ],
        ["1", "0"]
    ],
    vk_gamma_2: [
        [
            "10857046999023057135944570762232829481370756359578518086990519993285655852781",
            "11559732032986387107991004021392285783925812861821192530917403151452391805634"
        ],
        [
            "8495653923123431417604973247489272438418190587263600148770280649306958101930",
            "4082367875863433681332203403145435568316851327593401208105741076214120093531"
        ],
        ["1", "0"]
    ],
    vk_delta_2: [
        [
            "3697618915467790705869942236922063775466274665053173890632463796679068973252",
            "14948341351907992175709156460547989243732741534604949238422596319735704165658"
        ],
        [
            "3028459181652799888716942141752307629938889957960373621898607910203491239368",
            "11380736494786911280692284374675752681598754560757720296073023058533044108340"
        ],
        ["1", "0"]
    ],
    vk_alphabeta_12: [
        [
            [
                "2029413683389138792403550203267699914886160938906632433982220835551125967885",
                "21072700047562757817161031222997517981543347628379360635925549008442030252106"
            ],
            [
                "5940354580057074848093997050200682056184807770593307860589430076672439820312",
                "12156638873931618554171829126792193045421052652279363021382169897324752428276"
            ],
            [
                "7898200236362823042373859371574133993780991612861777490112507062703164551277",
                "7074218545237549455313236346927434013100842096812539264420499035217050630853"
            ]
        ],
        [
            [
                "7077479683546002997211712695946002074877511277312570035766170199895071832130",
                "10093483419865920389913245021038182291233451549023025229112148274109565435465"
            ],
            [
                "4595479056700221319381530156280926371456704509942304414423590385166031118820",
                "19831328484489333784475432780421641293929726139240675179672856274388269393268"
            ],
            [
                "11934129596455521040620786944827826205713621633706285934057045369193958244500",
                "8037395052364110730298837004334506829870972346962140206007064471173334027475"
            ]
        ]
    ],
    IC: [
        [
            "12951059800758687233303204819298121944551181861362200875212570257618182506154",
            "5751958719396509176593242305268064754837298673622815112953832050159760501392",
            "1"
        ],
        [
            "9561588427935871983444704959674198910445823619407211599507208879011862515257",
            "14576201570478094842467636169770180675293504492823217349086195663150934064643",
            "1"
        ],
        [
            "4811967233483727873912563574622036989372099129165459921963463310078093941559",
            "1874883809855039536107616044787862082553628089593740724610117059083415551067",
            "1"
        ],
        [
            "12252730267779308452229639835051322390696643456253768618882001876621526827161",
            "7899194018737016222260328309937800777948677569409898603827268776967707173231",
            "1"
        ]
    ]
}

dotenv.config()

const { BANDADA_API_URL, BANDADA_GROUP_ID } = process.env

const bandadaApi = new ApiSdk(BANDADA_API_URL)

export const bandadaValidateProof = functions
    .region("europe-west1")
    .runWith({
        memory: "512MB"
    })
    .https.onCall(async (data: BandadaValidateProof): Promise<VerifiedBandadaResponse> => {
        if (!BANDADA_GROUP_ID) throw new Error("BANDADA_GROUP_ID is not defined in .env")

        const { proof, publicSignals } = data
        const isCorrect = groth16.verify(VKEY_DATA, publicSignals, proof)
        if (!isCorrect)
            return {
                valid: false,
                message: "Invalid proof",
                token: ""
            }

        const commitment = data.publicSignals[1]
        const isMember = await bandadaApi.isGroupMember(BANDADA_GROUP_ID, commitment)
        if (!isMember)
            return {
                valid: false,
                message: "Not a member of the group",
                token: ""
            }
        const auth = getAuth()
        try {
            await admin.auth().createUser({
                uid: commitment
            })
        } catch (error: any) {
            // if user already exist then just pass
            if (error.code !== "auth/uid-already-exists") {
                throw new Error(error)
            }
        }
        const token = await auth.createCustomToken(commitment)
        return {
            valid: true,
            message: "Valid proof and group member",
            token
        }
    })

export default bandadaValidateProof
